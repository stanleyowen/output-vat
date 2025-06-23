#!/bin/bash

# Check if a file path was provided
if [ -z "$1" ]; then
    echo "Error: No Excel file specified"
    echo "Usage: $0 /path/to/excel/file.xlsx"
    exit 1
fi

EXCEL_FILE="$1"

# Create an AppleScript to control Excel
osascript <<EOF
tell application "Microsoft Excel"
    activate
    open "$EXCEL_FILE"
    tell active workbook
        save
        close saving yes
    end tell
    if (count of workbooks) is 0 then
        quit
    end if
end tell
EOF

echo "Excel file processed successfully: $EXCEL_FILE"