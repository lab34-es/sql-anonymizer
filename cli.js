#!/usr/bin/env node

const fs = require('fs');
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
const inputFile = argv.input;
const outputFile = argv.output;
const targetTableName = argv.table;
// Ensure targetTableName is treated as a literal string in the regex
const escapedTableName = targetTableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const columnIndicesToAnonymize = argv.columns; // Already 0-based from coerce

// Regex to match the target INSERT statement lines
// Handles optional schema prefix (like public.) and spaces
// Uses the escaped table name
const insertRegex = new RegExp(`^\\s*INSERT\\s+INTO\\s+(?:\\w+\\.)?${escapedTableName}\\s+VALUES\\s*\\(`, 'i');
console.log(`DEBUG: Using INSERT regex: ${insertRegex}`);

// --- Helper Functions ---

function generateRandomQuotedString(length = 16) {
    const randomHex = crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
    const randomString = `'${randomHex}'`;
    // console.log(`DEBUG: Generated random value: ${randomString}`); // Can be noisy
    return randomString;
}

function parseValues(valuesString) {
    // console.log(`DEBUG: parseValues input: "${valuesString}"`); // Can be noisy
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
            // console.log(`DEBUG: parseValues - Found value: "${currentVal.trim()}"`);
            values.push(currentVal.trim());
            currentVal = '';
        } else {
            currentVal += char;
        }
    }
    // Add the last value
    if (currentVal.trim() || values.length > 0 || valuesString.trim() === '') { // Handle empty last value, or single value case, or empty values list '()'
        // console.log(`DEBUG: parseValues - Found final value: "${currentVal.trim()}"`);
        values.push(currentVal.trim());
    }
    // console.log(`DEBUG: parseValues output: [${values.map(v => `"${v}"`).join(', ')}]`); // Can be noisy
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

    let fileStream;
    let writer;

    try {
        console.log(`DEBUG: Creating read stream for: ${inputFile}`);
        fileStream = fs.createReadStream(inputFile, { encoding: 'utf8' });
        console.log(`DEBUG: Creating write stream for: ${outputFile}`);
        writer = fs.createWriteStream(outputFile, { encoding: 'utf8' });
    } catch (err) {
        console.error("FATAL: Error setting up file streams:", err);
        process.exit(1);
    }

    let processedStatements = 0;
    let successfullyAnonymizedStatements = 0;
    let statementsWithErrors = 0;
    let statementsWithSkippedAnonymization = 0;

    // Create a transform stream to process SQL statements
    const processStream = async () => {
        return new Promise((resolve, reject) => {
            let buffer = '';
            let inInsertStatement = false;
            let currentStatement = '';
            
            fileStream.on('data', (chunk) => {
                buffer += chunk;
                
                // Process complete statements
                let statementEndIndex;
                while ((statementEndIndex = buffer.indexOf(';')) !== -1) {
                    const statement = buffer.substring(0, statementEndIndex + 1);
                    buffer = buffer.substring(statementEndIndex + 1);
                    
                    processStatement(statement);
                }
            });
            
            fileStream.on('end', () => {
                // Process any remaining data in the buffer
                if (buffer.trim()) {
                    processStatement(buffer);
                }
                
                // Finish the write stream
                writer.end(() => {
                    console.log('\n-------------------- Summary --------------------');
                    console.log(`Total statements processed: ${processedStatements}`);
                    console.log(`Statements successfully anonymized: ${successfullyAnonymizedStatements}`);
                    console.log(`Statements skipped: ${statementsWithSkippedAnonymization}`);
                    console.log(`Statements with processing errors: ${statementsWithErrors}`);
                    console.log(`Output written to: ${outputFile}`);
                    console.log('-----------------------------------------------');
                    console.log('Anonymization Process Finished.');
                    resolve();
                });
            });
            
            fileStream.on('error', (err) => {
                console.error(`\nFATAL: Error reading input file: ${inputFile}`, err);
                reject(err);
            });
            
            writer.on('error', (err) => {
                console.error(`\nFATAL: Error writing to output file: ${outputFile}`, err);
                reject(err);
            });
        });
    };
    
    // Process a complete SQL statement
    const processStatement = (statement) => {
        processedStatements++;
        
        // Log progress
        if (processedStatements % 1000 === 0) {
            console.log(`DEBUG: Processing statement ${processedStatements}...`);
        }
        
        // Check if this is an INSERT statement for our target table
        if (insertRegex.test(statement)) {
            try {
                // Extract all value sets from the INSERT statement
                const valueSetRegex = /\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
                let valueSetMatch;
                let modifiedStatement = statement;
                let modified = false;
                
                // Find the position of VALUES keyword to split the statement
                const valuesPos = statement.toUpperCase().indexOf('VALUES');
                if (valuesPos === -1) {
                    throw new Error('Could not find VALUES keyword in INSERT statement');
                }
                
                // Split the statement into prefix and values part
                const prefix = statement.substring(0, valuesPos + 'VALUES'.length);
                let valuesPart = statement.substring(valuesPos + 'VALUES'.length);
                
                // Process each value set
                const valueSets = [];
                while ((valueSetMatch = valueSetRegex.exec(valuesPart)) !== null) {
                    const fullMatch = valueSetMatch[0]; // The entire match including parentheses
                    const valuesString = valueSetMatch[1]; // Just the values inside parentheses
                    
                    try {
                        const values = parseValues(valuesString);
                        
                        // Check if indices are valid for this value set
                        const maxIndex = columnIndicesToAnonymize.length > 0 ? Math.max(...columnIndicesToAnonymize) : -1;
                        
                        if (maxIndex >= values.length) {
                            console.warn(`WARN: Statement ${processedStatements}, value set: Found ${values.length} values, but needed index ${maxIndex}. Keeping original values.`);
                            valueSets.push(fullMatch);
                            continue;
                        }
                        
                        // Anonymize the specified columns
                        let valueSetModified = false;
                        columnIndicesToAnonymize.forEach(index => {
                            if (index < values.length) {
                                const newValue = generateRandomQuotedString();
                                values[index] = newValue;
                                valueSetModified = true;
                                modified = true;
                            }
                        });
                        
                        if (valueSetModified) {
                            valueSets.push(`(${values.join(', ')})`);
                        } else {
                            valueSets.push(fullMatch);
                        }
                    } catch (error) {
                        console.error(`\nERROR: Failed to parse or process value set in statement ${processedStatements}:`);
                        console.error(`   -> Value set: ${fullMatch}`);
                        console.error(`   -> Error: ${error.message}`);
                        valueSets.push(fullMatch); // Keep original on error
                    }
                }
                
                if (modified) {
                    // Reconstruct the statement with anonymized values
                    modifiedStatement = `${prefix} ${valueSets.join(',\n\t')};`;
                    writer.write(modifiedStatement + '\n\n');
                    successfullyAnonymizedStatements++;
                } else {
                    writer.write(statement + '\n');
                    statementsWithSkippedAnonymization++;
                }
            } catch (error) {
                statementsWithErrors++;
                console.error(`\nERROR: Failed to process statement ${processedStatements}:`);
                console.error(`   -> Statement (start): ${statement.substring(0, 150)}...`);
                console.error(`   -> Error: ${error.message}`);
                writer.write(statement + '\n'); // Write original statement on error
            }
        } else {
            // Not a target INSERT statement, write it directly
            writer.write(statement + '\n');
        }
    };
    
    // Start processing
    try {
        await processStream();
    } catch (error) {
        console.error('\nFATAL: Error during processing:', error);
        process.exit(1);
    }
    
    // Catch unhandled promise rejections (just in case)
    process.on('unhandledRejection', (reason, promise) => {
        console.error('\nFATAL: Unhandled Rejection at:', promise, 'reason:', reason);
        process.exit(1);
    });
    
    process.on('uncaughtException', (error) => {
        console.error('\nFATAL: Uncaught Exception:', error);
        process.exit(1);
    });
}

// --- Run the process ---
processFile(); // Removed .catch here as errors should be handled within or via process events
