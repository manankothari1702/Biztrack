import * as fs from 'fs';
import * as path from 'path';

// Configuration
const TARGET_DIR = path.join(process.cwd(), 'src');
const SUSPICIOUS_PATTERNS = [
    { regex: /\.split\('T'\)/, message: "Manual ISO splitting detected" },
    { regex: /new Date\([a-zA-Z0-9_.]+(Date|Due)\)/, message: "Unsafe new Date() on possible date string" }, // specific to Date/Due naming
    { regex: /toISOString\(\).split/, message: "Manual ISO formatting detected" }
];

const IGNORE_FILES = ['dateUtils.ts', 'excelUtils.ts'];

function scanFile(filePath: string) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const filename = path.basename(filePath);

    if (IGNORE_FILES.includes(filename)) return;

    SUSPICIOUS_PATTERNS.forEach(pattern => {
        const lines = content.split('\n');
        lines.forEach((line, index) => {
            if (pattern.regex.test(line)) {
                console.log(`[WARNING] ${filename}:${index + 1}: ${pattern.message}`);
                console.log(`   ${line.trim()}`);
            }
        });
    });
}

function walkDir(dir: string) {
    const files = fs.readdirSync(dir);
    files.forEach(file => {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            walkDir(fullPath);
        } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
            scanFile(fullPath);
        }
    });
}

console.log(`Scanning ${TARGET_DIR} for date handling issues...`);
walkDir(TARGET_DIR);
console.log('Scan complete.');
