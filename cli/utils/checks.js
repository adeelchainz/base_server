const semver = require('semver')
const chalk = require('chalk')

const checkNodeVersion = () => {
    const requiredVersion = '>=14.0.0' // Set your required Node.js version
    const currentVersion = process.versions.node

    if (!semver.satisfies(currentVersion, requiredVersion)) {
        throw new Error(`Node.js version ${currentVersion} does not satisfy required version ${requiredVersion}. Please update your Node.js.`)
    }
}

module.exports = { checkNodeVersion }
