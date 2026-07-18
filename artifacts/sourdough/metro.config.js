const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

    // FORCE every dependency to share the exact same React instance on web
    'react': path.resolve(__dirname, 'node_modules/react'),
    'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    '@types/react': path.resolve(__dirname, 'node_modules/@types/react'),
  };
}

module.exports = config;
