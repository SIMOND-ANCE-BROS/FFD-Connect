import * as os from "os";
import * as fs from "fs";
import * as path from "path";

// Get __dirname - calculate from process.cwd() since script runs from backend directory
// This works regardless of CommonJS/ESM compilation
const __dirname = path.resolve(process.cwd(), "scripts");

function getLocalIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const ifaceList = interfaces[name];
    if (!ifaceList) continue;

    for (const iface of ifaceList) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1"; // Fallback
}

const ip = getLocalIp();
console.warn(`Detected Local IP: ${ip}`);

const clientConfigPath = path.join(__dirname, "../../client/src/config.ts");

if (fs.existsSync(clientConfigPath)) {
  let content = fs.readFileSync(clientConfigPath, "utf8");
  const regex = /const LOCAL_IP = '.*'; \/\/ Updated automatically/;
  const match = content.match(regex);

  if (match) {
    const currentIp = match[0].match(/'([^']+)'/)?.[1];

    // Only update if IP has changed to avoid triggering file watchers unnecessarily
    if (currentIp !== ip) {
      const replacement = `const LOCAL_IP = '${ip}'; // Updated automatically`;
      content = content.replace(regex, replacement);
      fs.writeFileSync(clientConfigPath, content);
      console.warn(`Updated client config with IP: ${ip} (was: ${currentIp})`);
    } else {
      console.warn(`Client config IP already correct: ${ip}`);
    }
  } else {
    console.warn("Could not find LOCAL_IP line in client config to update.");
  }
} else {
  console.warn(`Client config file not found at: ${clientConfigPath}`);
}
