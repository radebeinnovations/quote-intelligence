import { execSync } from 'node:child_process';

const port = process.argv[2] || 3001;

console.log(`Looking for process on port ${port}...`);

try {
  // Use absolute paths to bypass broken PATH issues on Windows
  const netstat = 'C:\\Windows\\System32\\netstat.exe';
  const findstr = 'C:\\Windows\\System32\\findstr.exe';
  const taskkill = 'C:\\Windows\\System32\\taskkill.exe';

  const output = execSync(`${netstat} -ano | ${findstr} :${port}`).toString();
  const lines = output.split('\n').filter(line => line.includes('LISTENING'));
  
  if (lines.length === 0) {
    console.log(`No process found listening on port ${port}.`);
    process.exit(0);
  }

  // Extract PID from the first matching line
  const columns = lines[0].trim().split(/\s+/);
  const pid = columns[columns.length - 1];

  console.log(`Found process ${pid} listening on port ${port}. Attempting to kill...`);
  
  // Use taskkill to terminate the process tree
  execSync(`${taskkill} /F /PID ${pid} /T`);
  
  console.log(`✅ Successfully killed process ${pid}. Port ${port} is now free!`);
} catch (error) {
  if (error.status === 1) {
     console.log(`No process found listening on port ${port}.`);
  } else {
     console.error('Failed to kill process:', error.message);
  }
}
