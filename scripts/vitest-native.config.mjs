// Runs this plain-JavaScript suite without esbuild or Windows realpath helpers
// spawning subprocesses. Keeps dependencies installed through a junction usable.
export default {
  resolve: { preserveSymlinks: true },
  esbuild: false,
  optimizeDeps: { noDiscovery: true, include: [] },
  test: {
    include: ['src/**/*.test.js', 'scripts/**/*.test.js'],
    environment: 'node',
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
    fileParallelism: false,
  },
};
