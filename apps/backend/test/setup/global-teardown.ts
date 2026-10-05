export default function globalTeardown() {
  // Nothing to tear down globally — each test suite cleans its own data
  console.log("\n✅ Integration tests completed\n");
}
