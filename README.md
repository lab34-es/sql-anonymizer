# SQL Anonymizer

A command-line tool to anonymize sensitive data in large SQL files, using streams. This tool works on both Windows and Unix-like systems.

## Features

- Anonymizes specific columns in SQL INSERT statements
- Preserves SQL structure and formatting
- Works with large SQL files
- Cross-platform compatibility (Windows, macOS, Linux)
- Configurable column selection

## Usage

### Command Line

```bash
npx @lab34/sql-anonymizer -i <input-file> -o <output-file> -t <table-name> -c <column-numbers>
```

### Options

- `-i, --input`: Path to the input SQL file (required)
- `-o, --output`: Path to the output anonymized SQL file (required)
- `-t, --table`: Name of the table to target (e.g., public.products or products) (required)
- `-c, --columns`: Comma-separated list of 1-based column numbers to anonymize (required)
- `-h, --help`: Show help information

### Example

```bash
npx @lab34/sql-anonymizer -i data.sql -o anonymized.sql -t users -c 2,3,5
```

This will anonymize columns 2, 3, and 5 in all INSERT statements for the "users" table in data.sql and save the result to anonymized.sql.

## How It Works

1. The tool parses the input SQL file and identifies INSERT statements for the specified table.
2. For each matching INSERT statement, it extracts the values and replaces the specified columns with *random strings*.
3. The anonymized SQL is written to the output file, preserving the original structure.

## Notes for Windows Users

- The tool handles Windows-style line endings (CRLF) correctly
- File paths can use either forward slashes (/) or backslashes (\\)
- Output directories are created automatically if they don't exist

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
