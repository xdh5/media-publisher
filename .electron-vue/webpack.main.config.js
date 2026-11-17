'use strict'

const path = require('path')
const { dependencies } = require('../package.json')
const webpack = require('webpack')

const userConfig = {
  NODE_ENV: "development",
  URL_SIGNATURE: "true",
  TERGET_ENV: "development",
}

let mainConfig = {
  infrastructureLogging: {
    level: 'warn'
  },
  entry: {
    main: path.join(__dirname, '../src/main/index.js')
  },
  externals: [
    ...Object.keys(dependencies || {}),
    'electron'
  ],
  module: {
    rules: [
      {
        test: /\.js$/,
        loader: 'esbuild-loader',
        options: { target: 'es2022' }
      },
      {
        test: /\.node$/,
        use: 'node-loader'
      }
    ]
  },
  node: {
    __dirname: process.env.NODE_ENV !== 'production',
    __filename: process.env.NODE_ENV !== 'production'
  },
  output: {
    filename: '[name].js',
    libraryTarget: 'commonjs2',
    path: path.join(__dirname, '../dist/electron')
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.userConfig': JSON.stringify(userConfig)
    })
  ],
  resolve: {
    extensions: ['.js', '.json', '.node']
  },
  target: 'electron-main',
}

/**
 * Adjust mainConfig for development settings
 */
if (process.env.NODE_ENV !== 'production') {
  mainConfig.plugins.push(
    new webpack.DefinePlugin({
      'process.env.libPath': `"${path.join(__dirname, '..').replace(/\\/g, '\\\\')}"`
    })
  )
}

module.exports = mainConfig
