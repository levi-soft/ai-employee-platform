
module.exports = {
  extends: ['next/core-web-vitals'],
  rules: {
    // Disable React import requirement for Next.js 13+
    'react/react-in-jsx-scope': 'off',
    'react/jsx-uses-react': 'off',
    // Allow console for development
    'no-console': 'warn',
    // Allow unused vars in development
    'no-unused-vars': 'warn'
  }
}
