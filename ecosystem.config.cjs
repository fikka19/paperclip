module.exports = {
  apps: [
    {
      name: "paperclip",
      script: "pnpm dev:once",
      env: {
        ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      },
    },
  ],
};
