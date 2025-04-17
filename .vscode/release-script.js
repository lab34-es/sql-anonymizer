#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

// Create interface to read user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Function to execute commands and display output
function runCommand(command) {
  console.log(`\n\x1b[36m> ${command}\x1b[0m`);
  try {
    const output = execSync(command, { encoding: 'utf8' });
    if (output.trim()) console.log(output.trim());
    return output.trim();
  } catch (error) {
    console.error(`\x1b[31mError: ${error.message}\x1b[0m`);
    throw error;
  }
}

// Function to update version in package.json
function updateVersion(type) {
  const packageJsonPath = path.resolve(process.cwd(), 'package.json');
  const packageJson = require(packageJsonPath);
  const currentVersion = packageJson.version;
  console.log(`Current version: ${currentVersion}`);
  
  const [major, minor, patch] = currentVersion.split('.').map(Number);
  let newVersion;
  
  switch (type.toLowerCase()) {
    case 'major':
      newVersion = `${major + 1}.0.0`;
      break;
    case 'minor':
      newVersion = `${major}.${minor + 1}.0`;
      break;
    case 'patch':
      newVersion = `${major}.${minor}.${patch + 1}`;
      break;
    default:
      throw new Error(`Invalid version type: ${type}`);
  }
  
  packageJson.version = newVersion;
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
  
  console.log(`\x1b[32mVersion updated to: ${newVersion}\x1b[0m`);
  return newVersion;
}

// Main function
async function main() {
  try {
    // Check if we are in a git repository
    try {
      runCommand('git rev-parse --is-inside-work-tree');
    } catch (error) {
      console.error('\x1b[31mError: You are not inside a git repository.\x1b[0m');
      process.exit(1);
    }
    
    // Check for uncommitted changes
    const status = runCommand('git status --porcelain');
    if (status) {
      console.log('\x1b[33mWarning: There are uncommitted changes in the repository.\x1b[0m');
      await new Promise((resolve) => {
        rl.question('\x1b[33mDo you want to continue anyway? (y/N): \x1b[0m', (answer) => {
          if (answer.toLowerCase() !== 'y') {
            console.log('Operation cancelled.');
            process.exit(0);
          }
          resolve();
        });
      });
    }
    
    // Request version type
    const versionType = await new Promise((resolve) => {
      rl.question('\nWhat type of update do you want to perform? (patch/minor/major): ', (answer) => {
        const type = answer.trim().toLowerCase();
        if (!['patch', 'minor', 'major'].includes(type)) {
          console.error('\x1b[31mError: Invalid version type. Must be patch, minor or major.\x1b[0m');
          process.exit(1);
        }
        resolve(type);
      });
    });
    
    // Update version
    const newVersion = updateVersion(versionType);
    
    // Request commit message
    const defaultCommitMsg = `chore: update version to ${newVersion}`;
    const commitMessage = await new Promise((resolve) => {
      rl.question(`\nCommit message [${defaultCommitMsg}]: `, (answer) => {
        resolve(answer.trim() || defaultCommitMsg);
      });
    });
    
    // Request release description
    const releaseDesc = await new Promise((resolve) => {
      rl.question('\nRelease description (leave blank for auto-generated notes): ', (answer) => {
        resolve(answer.trim());
      });
    });
    
    console.log('\n\x1b[34m=== Running release process ===\x1b[0m');
    
    // Add changes
    runCommand('git add package.json');
    
    // Commit changes
    runCommand(`git commit -m "${commitMessage}"`);
    
    // Push changes
    runCommand('git push');
    
    // Create tag
    const tagName = `v${newVersion}`;
    runCommand(`git tag -a ${tagName} -m "${commitMessage}"`);
    
    // Push tag
    runCommand('git push --tags');
    
    // Check if gh CLI is installed
    try {
      runCommand('gh --version');
    } catch (error) {
      console.error('\x1b[31mError: GitHub CLI (gh) is not installed. Cannot create release.\x1b[0m');
      console.log('You can install GitHub CLI from: https://cli.github.com/');
      console.log('\x1b[32mThe version update and tag creation process has completed successfully.\x1b[0m');
      process.exit(0);
    }
    
    // Create release in GitHub using gh cli
    const releaseCommand = releaseDesc 
      ? `gh release create ${tagName} --title "Version ${newVersion}" --notes "${releaseDesc}"`
      : `gh release create ${tagName} --title "Version ${newVersion}" --generate-notes`;
    
    runCommand(releaseCommand);
    
    console.log('\n\x1b[32m✓ Process completed successfully\x1b[0m');
    console.log(`\x1b[32m✓ Version ${newVersion} published and release created on GitHub\x1b[0m`);
    
  } catch (error) {
    console.error(`\x1b[31mError in the process: ${error.message}\x1b[0m`);
  } finally {
    rl.close();
  }
}

main();