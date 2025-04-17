# lab34-sql-anonymizer

A command-line tool for anonymizing sensitive data in SQL dump files. This tool processes SQL INSERT statements and replaces specific column values with random strings, making it ideal for creating anonymized database dumps for testing and development environments.

## Features

- Targets specific tables in SQL dump files
- Anonymizes selected columns by position
- Preserves SQL syntax and structure
- Handles complex SQL statements with proper parsing
- Provides detailed logging and error handling
- Fast processing of large SQL files

## Installation

### Prerequisites

- Node.js (v12 or higher)

### Global Installation

```bash
npm install -g lab34-sql-anonymizer
```

### Local Installation

```bash
npm install lab34-sql-anonymizer
```

## Usage

### Basic Usage

```bash
sql-anonymizer -i input.sql -o output.sql -t tablename -c 2,9
```

### Command-line Options

| Option | Alias | Description | Required |
|--------|-------|-------------|----------|
| `-i` | `--input` | Path to the input SQL file | Yes |
| `-o` | `--output` | Path to the output anonymized SQL file | Yes |
| `-t` | `--table` | Name of the table to target (e.g., `public.products` or `products`) | Yes |
| `-c` | `--columns` | Comma-separated list of 1-based column numbers to anonymize | Yes |
| `-h` | `--help` | Show help | No |

### Examples

Anonymize the 2nd and 9th columns in all INSERT statements for the `public.products` table:

```bash
sql-anonymizer -i dump.sql -o anonymized_dump.sql -t public.products -c 2,9
```

Anonymize multiple columns in a table without schema prefix:

```bash
sql-anonymizer -i dump.sql -o anonymized_dump.sql -t users -c 2,3,4,7
```

## How It Works

1. The tool reads the input SQL file line by line
2. It identifies INSERT statements for the specified table
3. For each matching INSERT statement, it:
   - Parses the values in the statement
   - Replaces the values in the specified columns with random hexadecimal strings
   - Preserves the original SQL structure and syntax
4. The modified SQL is written to the output file
5. Non-matching statements are copied to the output file unchanged

The anonymization process uses cryptographically secure random values to replace sensitive data, ensuring that the anonymized data cannot be traced back to the original values.

## Example

### Input SQL

```sql
INSERT INTO public.products VALUES
	(55, '998833859647493', 'MARKETING', '9', 1234, '2021-02-03 11:58:50.065', false, true, 'pricing_example.xslx', 'AVAILABLE', 'MARKETING', 1234),
	(56, '998833859647494', 'MARKETING', '9', 1234, '2021-02-03 11:58:50.065', false, true, 'pricing_example.xslx', 'AVAILABLE', 'MARKETING', 1234);
```

### Command

```bash
sql-anonymizer -i input.sql -o output.sql -t public.products -c 2,9
```

### Output SQL

```sql
INSERT INTO public.products VALUES 
	(55, 'f5cc399366bd4f27', 'MARKETING', '9', 1234, '2021-02-03 11:58:50.065', false, true, '1eb7343e27a1ef21', 'AVAILABLE', 'MARKETING', 1234),
	(56, '09316e9f388a0018', 'MARKETING', '9', 1234, '2021-02-03 11:58:50.065', false, true, '48f8935f445b817d', 'AVAILABLE', 'MARKETING', 1234);
```

## Use Cases

- Creating anonymized database dumps for development environments
- Removing sensitive customer data from production database backups
- Preparing data for third-party analysis while protecting privacy
- Compliance with data protection regulations (GDPR, CCPA, etc.)

## Limitations

- The tool currently only processes INSERT statements
- Column selection is position-based, not name-based
- The tool assumes standard SQL syntax

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
