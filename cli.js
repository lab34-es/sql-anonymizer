#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

// --- Argument Parsing ---
console.log("DEBUG: Parsing arguments...");
const argv = yargs(hideBin(process.argv))
    .usage('Usage: $0 -i <input file> -o <output file> -t <table name> -c <column numbers>')
    .option('i', {
        alias: 'input',
        describe: 'Path to the input SQL file',
        type: 'string',
        demandOption: true,
    })
    .option('o', {
        alias: 'output',
        describe: 'Path to the output anonymized SQL file',
        type: 'string',
        demandOption: true,
    })
    .option('t', {
        alias: 'table',
        describe: 'Name of the table to target (e.g., public.products or products)',
        type: 'string',
        demandOption: true,
    })
    .option('c', {
        alias: 'columns',
        describe: 'Comma-separated list of 1-based column numbers to anonymize',
        type: 'string',
        demandOption: true,
        coerce: (arg) => {
            console.log(`DEBUG: Coercing columns argument: "${arg}"`);
            try {
                const indices = arg.split(',').map(numStr => {
                    const num = parseInt(numStr.trim(), 10);
                    if (isNaN(num) || num < 1) {
                        throw new Error(`Invalid column number: ${numStr}. Must be a positive integer.`);
                    }
                    return num - 1; // Convert to 0-based index
                });
                indices.sort((a, b) => a - b);
                console.log(`DEBUG: Coerced 0-based indices: [${indices.join(', ')}]`);
                return indices;
            } catch (e) {
                 console.error("DEBUG: Error during column coercion:", e.message);
                 throw e; // Re-throw to let yargs handle it
            }
        }
    })
    .help()
    .alias('h', 'help')
    .strict()
    .argv;

// --- Configuration ---
const inputFile = path.resolve(argv.input);
const outputFile = path.resolve(argv.output);

// Ensure output directory exists
try {
    const outputDir = path.dirname(outputFile);
    if (!fs.existsSync(outputDir)) {
        console.log(`DEBUG: Creating output directory: ${outputDir}`);
        fs.mkdirSync(outputDir, { recursive: true });
    }
} catch (err) {
    console.error("FATAL: Error creating output directory:", err);
    process.exit(1);
}
const targetTableName = argv.table;
// Ensure targetTableName is treated as a literal string in the regex
const escapedTableName = targetTableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const columnIndicesToAnonymize = argv.columns; // Already 0-based from coerce

// Regex to match the target INSERT statement lines
// MODIFIED: Now optionally matches a column list `(...)` between table name and VALUES.
// Also made it work anywhere in the statement, not just at the beginning
// Added support for OVERRIDING SYSTEM VALUE and other optional clauses
const insertRegex = new RegExp(`INSERT\\s+INTO\\s+(?:\\w+\\.)?${escapedTableName}\\s*(?:\\([^)]*\\)\\s*)?(?:(?:OVERRIDING\\s+(?:SYSTEM|USER)\\s+VALUE|DEFAULT\\s+VALUES|[^;()]*?)\\s+)?VALUES\\s*\\(`, 'i');
console.log(`DEBUG: Using INSERT regex (with optional clauses): ${insertRegex}`);

// --- Helper Functions ---

/**
 * Generates a random hexadecimal string enclosed in single quotes.
 * @param {number} length - The desired length of the hex string inside the quotes.
 * @returns {string} - A random quoted hex string (e.g., 'a1b2c3d4').
 */
function generateRandomQuotedString(length = 16) {
    const randomHex = crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
    const randomString = `'${randomHex}'`;
    return randomString;
}

/**
 * Parses a string containing comma-separated SQL values, handling quoted strings
 * and escaped quotes ('').
 * @param {string} valuesString - The string content inside the parentheses of VALUES().
 * @returns {string[]} - An array of parsed values as strings.
 */
function parseValues(valuesString) {
    const values = [];
    let currentVal = '';
    let inQuotes = false;
    let quoteChar = null; // Could be ' or potentially " later

    for (let i = 0; i < valuesString.length; i++) {
        const char = valuesString[i];

        if (char === "'" && !inQuotes) { // Start quote
            inQuotes = true;
            quoteChar = "'";
            currentVal += char;
        } else if (char === "'" && inQuotes && quoteChar === "'") { // End quote or escaped quote
            if (i + 1 < valuesString.length && valuesString[i+1] === "'") { // Escaped quote ('')
                 currentVal += "''";
                 i++; // Skip the next quote
            } else { // End quote
                inQuotes = false;
                quoteChar = null;
                currentVal += char;
            }
        } else if (char === ',' && !inQuotes) {
            values.push(currentVal.trim());
            currentVal = '';
        } else {
            currentVal += char;
        }
    }
    // Add the last value
    if (currentVal.trim() || values.length > 0 || valuesString.trim() === '') { // Handle empty last value, or single value case, or empty values list '()'
        values.push(currentVal.trim());
    }
    return values;
}


// --- Main Processing Logic ---
async function processFile() {
    console.log(`\n--- Starting Anonymization ---`);
    console.log(`Input file: ${inputFile}`);
    console.log(`Output file: ${outputFile}`);
    console.log(`Target table: ${targetTableName}`);
    console.log(`Anonymizing columns (0-based indices): [${columnIndicesToAnonymize.join(', ')}]`);
    console.log(`------------------------------\n`);

    let writer;
    try {
        console.log(`DEBUG: Creating write stream for: ${outputFile}`);
        writer = fs.createWriteStream(outputFile, { encoding: 'utf8' });
    } catch (err) {
        console.error("FATAL: Error creating write stream:", err);
        process.exit(1);
    }

    // Use readline to handle line endings correctly
    const rl = readline.createInterface({
        input: fs.createReadStream(inputFile, { encoding: 'utf8' }),
        crlfDelay: Infinity // Important for handling Windows line endings (\r\n)
    });

    let processedStatements = 0;
    let successfullyAnonymizedStatements = 0;
    let statementsWithErrors = 0;
    let statementsWithSkippedAnonymization = 0; // Includes non-target statements
    let currentStatementBuffer = '';
    let lineNumber = 0;

    // Event handler for each line read
    rl.on('line', (line) => {
        lineNumber++;
        
        // Log every 100 lines for debugging
        if (lineNumber % 10000 === 0) {
            console.log(`DEBUG: Reading line ${lineNumber}`);
        }
        
        // Append the line and a standard newline to the buffer
        // This normalizes line endings in the buffer
        currentStatementBuffer += line + '\n';

        // Basic check if the line likely ends a statement.
        if (line.trimEnd().endsWith(';')) {
            console.log(`DEBUG: Found statement end at line ${lineNumber}: ${line.substring(0, Math.min(50, line.length))}...`);
            
            // Check if this is a multi-statement line (multiple semicolons)
            if (line.indexOf(';') !== line.lastIndexOf(';')) {
                console.log(`DEBUG: Line ${lineNumber} contains multiple statements. Processing separately.`);
                
                // Split the buffer at each semicolon and process each part
                const parts = currentStatementBuffer.split(';');
                
                // Process all but the last part (which is empty)
                for (let i = 0; i < parts.length - 1; i++) {
                    const part = parts[i] + ';'; // Add back the semicolon
                    if (part.trim()) {
                        processStatement(part, lineNumber);
                    }
                }
                
                currentStatementBuffer = ''; // Reset buffer
            } else {
                processStatement(currentStatementBuffer, lineNumber);
                currentStatementBuffer = ''; // Reset buffer for the next statement
            }
        }
    });

    // Event handler for the end of the file
    rl.on('close', () => {
        // Process any remaining content in the buffer
        if (currentStatementBuffer.trim()) {
            console.warn(`WARN: File ended without a semicolon. Processing remaining buffer.`);
            processStatement(currentStatementBuffer, lineNumber);
        }

        // Close the write stream and print summary
        writer.end(() => {
            console.log('\n-------------------- Summary --------------------');
            console.log(`Total statements processed: ${processedStatements}`);
            console.log(`Statements successfully anonymized: ${successfullyAnonymizedStatements}`);
            console.log(`Statements skipped (non-target/index issue/non-string): ${statementsWithSkippedAnonymization}`);
            console.log(`Statements with processing errors: ${statementsWithErrors}`);
            console.log(`Output written to: ${outputFile}`);
            console.log('-----------------------------------------------');
            console.log('Anonymization Process Finished.');
        });
    });

    // Error handling for reading the input file
    rl.on('error', (err) => {
        console.error(`\nFATAL: Error reading input file: ${inputFile}`, err);
        if (writer) writer.end();
        process.exit(1);
    });

    // Error handling for writing the output file
    writer.on('error', (err) => {
        console.error(`\nFATAL: Error writing to output file: ${outputFile}`, err);
        process.exit(1);
    });

    /**
     * Processes a complete SQL statement (potentially multi-line).
     * @param {string} statement - The complete SQL statement string.
     * @param {number} endLineNumber - The line number where the statement ended in the input file.
     */
    const processStatement = (statement, endLineNumber) => {
        processedStatements++;
        const startLineNumber = endLineNumber - (statement.match(/\n/g)?.length || 0); // Approximate start line

        // ADDED: Log the start of the statement being tested
        console.log(`DEBUG: Testing statement ending line ${endLineNumber} (start): [${statement.substring(0, 150).replace(/\n/g, '\\n')}...]`);

        // Log progress periodically
        if (processedStatements % 50 === 0) { // Log more frequently for debugging
            console.log(`DEBUG: Processing statement count ${processedStatements}...`);
        }

        // Check if the statement contains our target INSERT pattern
        // Using search instead of test to find the pattern anywhere in the statement
        if (statement.search(insertRegex) !== -1) {
            console.log(`DEBUG: Matched INSERT regex for statement ending near line ${endLineNumber}`);
            let statementModified = false; // Track if the overall statement was modified
            let statementHadAnonymizationError = false; // Track errors within value sets

            try {
                // Find the position of VALUES keyword to split the statement
                // Use regex to find VALUES reliably, case-insensitive
                const valuesMatch = statement.match(/\sVALUES\s*\(/i);
                if (!valuesMatch || typeof valuesMatch.index === 'undefined') {
                     // If VALUES isn't found, it's not a standard INSERT we can process
                    //  console.warn(`WARN: Stmt ending line ${endLineNumber}: Matched INSERT pattern but could not find VALUES keyword. Skipping.`);
                     writer.write(statement);
                     statementsWithSkippedAnonymization++;
                     return; // Skip this statement
                }
                const valuesIndex = valuesMatch.index;

                // Split the statement into prefix and values part
                const prefix = statement.substring(0, valuesIndex); // Part before VALUES
                let valuesPart = statement.substring(valuesIndex); // Part from VALUES onwards

                // Regex to find value sets: accounts for potential newlines between values
                const valueSetRegex = /\(\s*([^()]*?(?:\([^()]*\)[^()]*?)*?)\s*\)/gs;
                let valueSetMatch;
                const newValueSets = []; // Store original or modified value sets (as strings with parentheses)
                let overallModified = false; // Track if *any* value set in this statement was modified

                while ((valueSetMatch = valueSetRegex.exec(valuesPart)) !== null) {
                    const fullMatch = valueSetMatch[0]; // The entire match including parentheses and surrounding whitespace
                    const valuesString = valueSetMatch[1].trim(); // Just the values inside parentheses, trimmed

                    try {
                        const values = parseValues(valuesString); // Parse the comma-separated values

                        // Check if requested column indices are valid for this specific row
                        const maxIndex = columnIndicesToAnonymize.length > 0 ? Math.max(...columnIndicesToAnonymize) : -1;
                        if (maxIndex >= values.length) {
                            console.warn(`WARN: Stmt ending line ${endLineNumber}, value set: Found ${values.length} values, but needed index ${maxIndex}. Keeping original values.`);
                            newValueSets.push(fullMatch); // Keep original format
                            continue; // Skip anonymization for this value set
                        }

                        // Anonymize the specified columns within this value set
                        let valueSetModified = false; // Track if this specific set was changed
                        columnIndicesToAnonymize.forEach(index => {
                            if (index < values.length) {
                                const originalValue = values[index];
                                // SAFETY CHECK: Only anonymize if it looks like a string literal or is NULL.
                                if (originalValue.startsWith("'") || originalValue.toUpperCase() === 'NULL') {
                                    const newValue = generateRandomQuotedString();
                                    // console.log(`DEBUG: Stmt line ${endLineNumber}: Anonymizing index ${index} ('${originalValue}' -> '${newValue}')`);
                                    values[index] = newValue; // Replace value in the array
                                    valueSetModified = true;
                                    overallModified = true; // Mark the whole statement as modified
                                } else {
                                     console.log(`DEBUG: Stmt line ${endLineNumber}: Skipping anonymization for non-string/NULL value at index ${index}: ${originalValue}`);
                                }
                            } else {
                                // This case should be caught by maxIndex check, but added for safety
                                console.warn(`WARN: Stmt line ${endLineNumber}: Index ${index} out of bounds for value set (length ${values.length}).`);
                            }
                        });

                        // If this value set was modified, reconstruct it
                        if (valueSetModified) {
                             newValueSets.push(`( ${values.join(', ')} )`);
                        } else {
                            // Otherwise, keep the original matched string to preserve formatting
                            newValueSets.push(fullMatch);
                        }
                    } catch (error) {
                        // Error parsing or processing a specific value set
                        statementHadAnonymizationError = true; // Mark statement as having an error
                        console.error(`\nERROR: Failed to parse/process value set in statement ending line ${endLineNumber}:`);
                        console.error(`   -> Value string: ${valuesString}`);
                        console.error(`   -> Error: ${error.message}`);
                        newValueSets.push(fullMatch); // Keep original on error for this set
                    }
                } // End while loop for value sets

                // If any part of the statement was modified, reconstruct and write
                if (overallModified) {
                    // Reconstruct the values part carefully to preserve structure between sets
                    let reconstructedValuesPart = '';
                    let lastIndex = 0;
                    valueSetRegex.lastIndex = 0; // Reset regex index
                    let matchIndex = 0;
                    while ((valueSetMatch = valueSetRegex.exec(valuesPart)) !== null) {
                        // Append content between the last match and this one
                        reconstructedValuesPart += valuesPart.substring(lastIndex, valueSetMatch.index);
                        // Append the (potentially modified) value set from our array
                        reconstructedValuesPart += newValueSets[matchIndex];
                        lastIndex = valueSetRegex.lastIndex;
                        matchIndex++;
                    }
                    // Append any remaining content after the last value set (e.g., semicolon, comments)
                    reconstructedValuesPart += valuesPart.substring(lastIndex);

                    const modifiedStatement = `${prefix}${reconstructedValuesPart}`; // Combine prefix and reconstructed values part

                    writer.write(modifiedStatement); // Write the modified statement
                    successfullyAnonymizedStatements++;
                    statementModified = true; // Mark statement as modified for summary counting
                }

                // Handle final summary counting
                if (!statementModified) {
                    if (statementHadAnonymizationError) {
                        statementsWithErrors++; // Count statements with value set errors
                    } else {
                        statementsWithSkippedAnonymization++; // Count fully skipped statements
                    }
                    writer.write(statement); // Write original if no changes or only errors occurred
                } else if (statementHadAnonymizationError) {
                    // If it was modified BUT also had errors, count the error too
                    statementsWithErrors++;
                }


            } catch (error) {
                // Error processing the overall INSERT statement (e.g., finding VALUES)
                statementsWithErrors++;
                console.error(`\nERROR: Failed to process statement ending line ${endLineNumber}:`);
                console.error(`   -> Statement (start): ${statement.substring(0, 150)}...`);
                console.error(`   -> Error: ${error.message}`);
                writer.write(statement); // Write original statement on error
            }
        } else {
            // Not a target INSERT statement (regex didn't match)
             console.log(`DEBUG: Did not match INSERT regex for statement ending near line ${endLineNumber}`);
            writer.write(statement); // Write original statement
            statementsWithSkippedAnonymization++; // Count non-target statements as skipped
        }
    }; // End processStatement function

    // --- Global Error Handlers ---
    process.on('unhandledRejection', (reason, promise) => {
        console.error('\nFATAL: Unhandled Rejection at:', promise, 'reason:', reason);
        if (writer && !writer.closed) writer.end();
        process.exit(1);
    });

    process.on('uncaughtException', (error) => {
        console.error('\nFATAL: Uncaught Exception:', error);
        if (writer && !writer.closed) writer.end();
        process.exit(1);
    });

} // End processFile function

// --- Run the process ---
processFile();
