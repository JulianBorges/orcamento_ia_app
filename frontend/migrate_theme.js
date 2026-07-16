const fs = require('fs');
const path = require('path');

const files = [
    'src/app/page.tsx',
    'src/components/BudgetTable.tsx',
    'src/components/CompositionCreatorModal.tsx'
];

const replacements = [
    { from: /bg-\[\#09090b\]/g, to: 'bg-zinc-50 dark:bg-[#09090b]' },
    { from: /bg-\[\#18181b\]/g, to: 'bg-white dark:bg-[#18181b]' },
    { from: /bg-zinc-900/g, to: 'bg-white dark:bg-zinc-900' },
    { from: /bg-zinc-800/g, to: 'bg-zinc-100 dark:bg-zinc-800' },
    { from: /border-zinc-800/g, to: 'border-zinc-200 dark:border-zinc-800' },
    { from: /border-zinc-700/g, to: 'border-zinc-300 dark:border-zinc-700' },
    { from: /text-zinc-100/g, to: 'text-zinc-900 dark:text-zinc-100' },
    { from: /text-zinc-200/g, to: 'text-zinc-800 dark:text-zinc-200' },
    { from: /text-zinc-300/g, to: 'text-zinc-700 dark:text-zinc-300' },
    { from: /text-zinc-400/g, to: 'text-zinc-500 dark:text-zinc-400' },
    { from: /text-zinc-500/g, to: 'text-zinc-400 dark:text-zinc-500' }
];

files.forEach(file => {
    const filePath = path.join(__dirname, file);
    if (!fs.existsSync(filePath)) {
        console.error('File not found:', filePath);
        return;
    }
    
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Reverse possible previous runs to avoid duplication
    replacements.forEach(r => {
        const toStr = r.to;
        const toRegex = new RegExp(toStr.replace(/\[/g, '\\[').replace(/\]/g, '\\]'), 'g');
        content = content.replace(toRegex, r.from.source.replace(/\\/g, '').replace(/^\/|\/g$/g, ''));
    });
    
    // Apply replacements
    replacements.forEach(r => {
        content = content.replace(r.from, r.to);
    });
    
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Processed ${file}`);
});
