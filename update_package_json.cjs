const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join(process.cwd(), 'package.json');

fs.readFile(packageJsonPath, 'utf8', (err, data) => {
    if (err) {
        console.error(`Error reading package.json: ${err}`);
        process.exit(1);
    }

    let packageJson;
    try {
        packageJson = JSON.parse(data);
    } catch (parseErr) {
        console.error(`Error parsing package.json: ${parseErr}`);
        process.exit(1);
    }

    // Add new dependencies
    packageJson.dependencies = packageJson.dependencies || {};
    packageJson.dependencies.dockerode = '^4.0.0';
    packageJson.dependencies.express = '^4.19.2';
    packageJson.dependencies.ws = '^8.18.0';
    packageJson.dependencies['fs-extra'] = '^11.2.0';
    packageJson.dependencies.uuid = '^10.0.0';

    // Add new dev dependencies
    packageJson.devDependencies = packageJson.devDependencies || {};
    packageJson.devDependencies['@types/express'] = '^4.17.21';
    packageJson.devDependencies['@types/ws'] = '^8.5.10';
    packageJson.devDependencies['@types/uuid'] = '^10.0.0';
    packageJson.devDependencies.concurrently = '^8.2.2';

    // Remove @webcontainer/api and related packages
    delete packageJson.dependencies['@webcontainer/api'];
    delete packageJson.devDependencies['@webcontainer/api'];
    // Based on previous grep, also remove these if they exist as devDependencies
    delete packageJson.devDependencies['@webcontainer/auth'];
    delete packageJson.devDependencies['@webcontainer/preview'];

    fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf8', (writeErr) => {
        if (writeErr) {
            console.error(`Error writing package.json: ${writeErr}`);
            process.exit(1);
        } else {
            console.log('package.json updated successfully.');
            process.exit(0);
        }
    });
});
