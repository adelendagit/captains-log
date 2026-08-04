module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true,
  },
  extends: ["eslint:recommended"],
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "script",
  },
  ignorePatterns: ["node_modules/", "coverage/"],
  rules: {
    "no-unused-vars": [
      "warn",
      {
        argsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      },
    ],
  },
  overrides: [
    {
      files: ["public/js/**/*.js"],
      env: {
        browser: true,
        node: false,
      },
      globals: {
        L: "readonly",
        Sortable: "readonly",
      },
    },
    {
      files: ["public/js/captains-log.js"],
      rules: {
        // This legacy file installs an enhanced renderer later in the script.
        "no-func-assign": "off",
      },
    },
  ],
};
