import { createInterface } from 'readline';
import { promises as fs } from 'fs';
import { runRegisterFlow, runLoginFlow } from './automation.js';

const rl = createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function main() {
    console.log(`
=========================================
          CAPCUT AUTOMATION CLI          
=========================================
1. Register Accounts & Auto-Join Space
2. Login & Join Space (Dễ bị Limit IP)
3. Exit
=========================================`);
    
    const choice = await question('Select an option (1-3): ');

    if (choice === '1') {
        const countStr = await question('How many accounts to create? (default: 1): ');
        const count = parseInt(countStr) || 1;
        const password = await question('Enter custom password (leave blank for config default): ');
        
        const inviteUrlInput = await question('Enter space invite URL (leave blank to use from config.json): ');
        let inviteUrl = inviteUrlInput.trim();
        if (!inviteUrl) {
            try {
                const configStr = await fs.readFile('./config.json', 'utf-8');
                const config = JSON.parse(configStr);
                if (config.inviteUrl && config.inviteUrl.trim() !== '') {
                    inviteUrl = config.inviteUrl.trim();
                    console.log(`\n[Info] Using invite URL from config.json: ${inviteUrl}`);
                }
            } catch (e) {}
        }

        console.log(`\nStarting registration for ${count} accounts...\n`);
        await runRegisterFlow(count, password || undefined, null, inviteUrl || undefined);
        console.log('\nRegistration flow finished.\n');
        
    } else if (choice === '2') {
        const fileStr = await question('Enter path to accounts file (default: accounts.txt): ');
        const filePath = fileStr.trim() || 'accounts.txt';
        
        let accountList = [];
        try {
            const data = await fs.readFile(filePath, 'utf-8');
            accountList = data.split('\n').filter(line => line.trim() !== '');
            if (accountList.length === 0) {
                console.log(`\nNo accounts found in ${filePath}.\n`);
                return main();
            }
        } catch (e) {
            console.log(`\nError reading file ${filePath}: ${e.message}\n`);
            return main();
        }

        const inviteUrlInput = await question('Enter space invite URL (leave blank to use from config.json without pasting): ');
        let inviteUrl = inviteUrlInput.trim();
        
        if (!inviteUrl) {
            try {
                const configStr = await fs.readFile('./config.json', 'utf-8');
                const config = JSON.parse(configStr);
                if (config.inviteUrl && config.inviteUrl.trim() !== '') {
                    inviteUrl = config.inviteUrl.trim();
                    console.log(`\n[Info] Using invite URL from config.json: ${inviteUrl}`);
                }
            } catch (e) {
                // Ignore if config not found or invalid
            }
        }
        
        console.log(`\nStarting login flow for ${accountList.length} accounts...\n`);
        await runLoginFlow(accountList, inviteUrl || undefined, null);
        console.log('\nLogin flow finished.\n');
        
    } else if (choice === '3') {
        console.log('Exiting...');
        rl.close();
        process.exit(0);
        return;
    } else {
        console.log('Invalid option. Please try again.');
    }

    // Return to main menu simply
    console.log('\n--- Returning to menu ---\n');
    main();
}

main().catch(err => {
    console.error('Fatal error:', err);
    rl.close();
    process.exit(1);
});
