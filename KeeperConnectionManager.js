const { DynamoDBClient, ScanCommand, UpdateItemCommand } = require("@aws-sdk/client-dynamodb");
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const { unmarshall } = require("@aws-sdk/util-dynamodb");
const axios = require('axios');
const fs = require('fs');
const cliProgress = require('cli-progress');
require('dotenv').config();

let dynamoDBClient;
const secretsManagerClient = new SecretsManagerClient({ region: 'us-east-1' });

let keeperApiUrl = process.env.KEEPER_API_URL || 'https://poc-access.sailpoint.com';
let keeperUsername = process.env.KEEPER_USERNAME || '';
let keeperPassword = process.env.KEEPER_PASSWORD || '';
let keeperAuthToken = null;

let targetName = process.env.TARGET_NAME || '';
let environment = process.env.ENVIRONMENT || 'production';

const args = process.argv.slice(2);
const addUsersOnly = args.includes('--add-users-only');

async function getInstancePasswords() {
    try {
        const secretName = "instancePasswords"; 
        const secretCommand = new GetSecretValueCommand({ SecretId: secretName });
        const secretResponse = await secretsManagerClient.send(secretCommand);

        if (secretResponse.SecretString) {
            return JSON.parse(secretResponse.SecretString);
        } else {
            throw new Error('SecretString is empty or undefined');
        }
    } catch (error) {
        console.error('Error retrieving instance passwords from Secrets Manager:', error);
        throw error;
    }
}

async function setupWizard() {
    const { input, password, select } = await import('@inquirer/prompts');

    keeperUsername = await input({ message: 'Enter Keeper username:', default: keeperUsername });
    keeperPassword = await password({ message: 'Enter Keeper password:', mask: '*', default: keeperPassword });
    targetName = await input({ message: 'Enter the TENANT name (e.g. company0000-poc):', default: targetName });
    keeperApiUrl = await input({ message: 'Enter the Keeper API URL:', default: keeperApiUrl });
    environment = await select({
        message: 'Select environment:',
        choices: [
            { name: 'Production', value: 'production' },
            { name: 'Development', value: 'test' }
        ],
        default: environment
    });

    fs.writeFileSync('.env', `KEEPER_USERNAME=${keeperUsername}\nKEEPER_API_URL=${keeperApiUrl}\nTARGET_NAME=${targetName}\nENVIRONMENT=${environment}\n`);

    console.log('Configuration saved to .env file.');
}

async function authenticateToKeeper() {
    console.log(keeperUsername);

    try {
        const response = await axios.post(`${keeperApiUrl}/api/tokens`, `username=${encodeURIComponent(keeperUsername)}&password=${encodeURIComponent(keeperPassword)}`, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        keeperAuthToken = response.data.authToken;
        console.log('Successfully authenticated to Keeper.');
    } catch (error) {
        console.error('Error authenticating to Keeper:', error.response ? error.response.data : error.message);
        throw error;
    }
}

function setupDynamoDBClient() {
    const region = 'us-east-1';
    const tableName = `DemoHub-Reservations-${environment === 'production' ? 'prod' : 'dev'}`;
    dynamoDBClient = new DynamoDBClient({ region });

    return tableName;
}

async function queryDynamoDB(tableName) {
    const params = {
        TableName: tableName,
        FilterExpression: 'provisioningStatus = :status',
        ExpressionAttributeValues: { ':status': { S: 'PROVISIONED' } },
    };

    let items = [];
    let lastEvaluatedKey = null;

    const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    console.log("Querying DynamoDB...");
    progressBar.start(100, 0);  

    do {
        if (lastEvaluatedKey) {
            params.ExclusiveStartKey = lastEvaluatedKey;
        }

        const data = await dynamoDBClient.send(new ScanCommand(params));
        items = items.concat(data.Items.map(item => unmarshall(item)));

        lastEvaluatedKey = data.LastEvaluatedKey;

        progressBar.increment(100);  
    } while (lastEvaluatedKey);

    progressBar.stop();  
    return items;
}

async function updateDynamoDBRecord(guid) {
    const tableName = setupDynamoDBClient();

    const params = {
        TableName: tableName,
        Key: {
            "GUID": { S: guid }
        },
        UpdateExpression: "SET #attr = list_append(if_not_exists(#attr, :empty_list), :new_attr)",
        ExpressionAttributeNames: {
            "#attr": "attributes"
        },
        ExpressionAttributeValues: {
            ":new_attr": { L: [{ M: { name: { S: "KCM" }, value: { S: "yes" } } }] },
            ":empty_list": { L: [] }
        }
    };

    try {
        await dynamoDBClient.send(new UpdateItemCommand(params));
        console.log(`Successfully added the KCM flag to the attributes in DynamoDB for: ${guid}`);
    } catch (error) {
        console.error(`Failed to update DynamoDB record for GUID: ${guid}`, error);
    }
}

async function listConnections() {
    try {
        const response = await axios.get(`${keeperApiUrl}/api/session/data/mysql/connections`, {
            headers: {
                'Content-Type': 'application/json',
                'Guacamole-Token': keeperAuthToken
            }
        });

        return response.data;
    } catch (error) {
        console.error('Error listing connections:', error.response ? error.response.data : error.message);
        throw error;
    }
}

async function findAndProcessItem() {
    const tableName = setupDynamoDBClient();
    const items = await queryDynamoDB(tableName);
    const instancePasswords = await getInstancePasswords(); 

    let foundTarget = false;

    for (const item of items) {
        if (item.name === targetName) {
            console.log('Found target item');
            foundTarget = true;

            if (item.instanceStack) {
                await processInstanceStack(item.instanceStack, targetName, instancePasswords);

                // Add a KCM flag
                await updateDynamoDBRecord(item.GUID);
            } else {
                console.error(`Instance stack not found for tenant ${targetName}`);
            }
            break;
        }
    }

    if (!foundTarget) {
        console.error(`Tenant ${targetName} not found in DynamoDB.`);
        throw new Error(`Tenant ${targetName} not found in DynamoDB.`);
    }
}

async function processInstanceStack(instanceStack, groupName, instancePasswords) {
    const { input, password, select } = await import('@inquirer/prompts');

    const existingConnections = await listConnections();
    const existingConnectionNames = new Set(
        Object.values(existingConnections).map(conn => conn.name)
    );

    const instances = Object.values(instanceStack);
    const keeperConnections = [];

    for (const instance of instances) {
        if (instance.state === 'terminated') continue;

        let config = instancePasswords[instance.imageId];

        if (!config) {
            console.warn(`No configuration found for imageId ${instance.imageId}`);
            console.log(`We couldn't find the username, password, or protocol for the VM "${instance.displayName}".`);

            const selectedProtocol = await select({
                message: `Select protocol for VM "${instance.displayName}":`,
                choices: [
                    { name: 'RDP', value: 'rdp' },
                    { name: 'SSH', value: 'ssh' }
                ]
            });

            const enteredUsername = await input({ message: `Enter username for VM "${instance.displayName}":` });
            const enteredPassword = await password({ message: `Enter password for VM "${instance.displayName}":`, mask: '*' });

            config = {
                protocol: selectedProtocol,
                username: enteredUsername,
                password: enteredPassword
            };
        } else {
            if (config.username && !config.password) {
                console.log(`Password missing for VM "${instance.displayName}".`);

                const enteredPassword = await password({ message: `Enter password for VM "${instance.displayName}":`, mask: '*' });
                config.password = enteredPassword;
            }
        }

        const connectionName = `${groupName} - ${instance.displayName}`;

        if (!existingConnectionNames.has(connectionName)) {
            const connection = {
                name: connectionName,
                protocol: config.protocol,
                hostname: instance.publicIp || instance.publicDns || instance.publicIntDns, 
                groupName: groupName, 
                username: config.username,
                password: config.password
            };

            keeperConnections.push(connection);
        } else {
            console.log(`Connection "${connectionName}" already exists, skipping.`);
        }
    }

    if (keeperConnections.length > 0) {
        await sendToKeeper(groupName, keeperConnections);
    } else {
        console.log('No new connections to add.');
    }
}

async function processUsers(groupIdentifier) {
    const { input } = await import('@inquirer/prompts');
    let addAnotherUser = true;

    const connectionsResponse = await axios.get(`${keeperApiUrl}/api/session/data/mysql/connections`, {
        headers: {
            'Guacamole-Token': keeperAuthToken
        }
    });
    
    const groupConnections = Object.entries(connectionsResponse.data)
        .filter(([_, conn]) => conn.parentIdentifier === groupIdentifier)
        .map(([id, _]) => id);

    while (addAnotherUser) {
        const userEmail = await input({ message: 'Enter user email (or leave empty to finish):' });
        
        if (!userEmail.trim()) {
            addAnotherUser = false;
            continue;
        }

        let fullName = userEmail;
        let organization = '';
        
        const emailParts = userEmail.split('@');
        if (emailParts.length === 2) {
            organization = emailParts[1].split('.')[0];
            
            const namePart = emailParts[0];
            if (namePart.includes('.')) {
                fullName = namePart
                    .split('.')
                    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
                    .join(' ');
            }
        }

        try {
            const userResponse = await axios.get(`${keeperApiUrl}/api/session/data/mysql/users/${userEmail}`, {
                headers: {
                    'Guacamole-Token': keeperAuthToken
                }
            });

            console.log(`User ${userEmail} exists, granting permissions...`);
        } catch (error) {
            if (error.response && error.response.status === 404) {
                console.log(`Creating new user: ${userEmail}`);
                
                await axios.post(`${keeperApiUrl}/api/session/data/mysql/users`, {
                    username: userEmail,
                    password: 'Sailp0!nt',
                    attributes: {
                        expired: "true",
                        disabled: "",
                        'guac-email-address': userEmail,
                        'guac-full-name': fullName,
                        'guac-organization': organization
                    }
                }, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Guacamole-Token': keeperAuthToken
                    }
                });
            } else {
                console.error(`Error checking user ${userEmail}:`, error.message);
                continue;
            }
        }

        try {
            await axios.patch(
                `${keeperApiUrl}/api/session/data/mysql/users/${userEmail}/permissions`,
                [
                    {
                        op: "add",
                        path: "/connectionGroupPermissions/" + groupIdentifier,
                        value: "READ"
                    },
                    {
                        op: "add",
                        path: "/userPermissions/" + userEmail,
                        value: "UPDATE"
                    }
                ],
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Guacamole-Token': keeperAuthToken
                    }
                }
            );
            console.log(`Granted group permissions and password change permission to ${userEmail}`);

            if (groupConnections.length > 0) {
                const permissionPromises = groupConnections.map(connId => 
                    axios.patch(
                        `${keeperApiUrl}/api/session/data/mysql/users/${userEmail}/permissions`,
                        [{
                            op: "add",
                            path: "/connectionPermissions/" + connId,
                            value: "READ"
                        }],
                        {
                            headers: {
                                'Content-Type': 'application/json',
                                'Guacamole-Token': keeperAuthToken
                            }
                        }
                    ).then(() => {
                        console.log(`Granted permission to ${userEmail} for connection ${connId}`);
                    })
                );

                await Promise.all(permissionPromises);
                console.log(`Granted connection permissions to ${userEmail} for ${groupConnections.length} connections`);
            } else {
                console.log('No connections found in the group');
            }
        } catch (error) {
            console.error(`Error granting permissions to ${userEmail}:`, error.message);
            if (error.response) {
                console.error('Response data:', error.response.data);
            }
        }
    }
}

async function sendToKeeper(groupName, connections) {
    try {
        let groupIdentifier;
        try {
            const listGroupsResponse = await axios.get(`${keeperApiUrl}/api/session/data/mysql/connectionGroups`, {
                headers: {
                    'Content-Type': 'application/json',
                    'Guacamole-Token': keeperAuthToken
                }
            });

            const groups = listGroupsResponse.data;

            const groupArray = Object.values(groups);
            const group = groupArray.find(g => g.name === groupName);
            
            if (group) {
                groupIdentifier = group.identifier;
                console.log(`Connection group "${groupName}" already exists with identifier: ${groupIdentifier}`);
            } else {
                console.log(`Connection group "${groupName}" does not exist. Creating it now...`);
                const groupResponse = await axios.post(`${keeperApiUrl}/api/session/data/mysql/connectionGroups`, {
                    parentIdentifier: "ROOT",  
                    name: groupName,
                    type: "ORGANIZATIONAL",  
                    attributes: {
                        "max-connections": "", 
                        "max-connections-per-user": "",  
                        "enable-session-affinity": ""  
                    }
                }, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Guacamole-Token': keeperAuthToken
                    }
                });

                groupIdentifier = groupResponse.data.identifier;
                console.log('Group created:', groupResponse.data);
            }
        } catch (error) {
            throw error; 
        }

        for (const connection of connections) {
            let parameters = {
                hostname: connection.hostname,
                username: connection.username,
                password: connection.password,
                port: "",  // I don't think we need this as it defaults to 3389
                security: "nla",  // Network Level Authentication
                "ignore-cert": "true",  // Ignore server certificate, David mentioned this needs to be on
            };

            const connectionResponse = await axios.post(`${keeperApiUrl}/api/session/data/mysql/connections`, {
                parentIdentifier: groupIdentifier,  
                name: `${connection.name}`,
                protocol: connection.protocol, 
                parameters: parameters,
                attributes: {
                    "max-connections": "", 
                    "max-connections-per-user": "", 
                    "guacd-hostname": "", 
                    "guacd-port": "", 
                    "guacd-encryption": ""  
                }
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Guacamole-Token': keeperAuthToken
                }
            });

            console.log('Connection added:', connectionResponse.data);
        }

        console.log(`Added ${connections.length} connections to Keeper group ${groupName}`);

        console.log('\nNow managing user access...');
        await processUsers(groupIdentifier);
        
    } catch (error) {
        if (error.response) {
            console.error(`Error: ${error.response.status} - ${error.response.statusText}`);
            console.error(`Details: ${JSON.stringify(error.response.data, null, 2)}`);
        } else if (error.request) {
            console.error('Error: No response received from Keeper');
            console.error(error.request);
        } else {
            console.error('Error:', error.message);
        }
    }
}

async function getGroupIdentifier(groupName) {
    try {
        const listGroupsResponse = await axios.get(`${keeperApiUrl}/api/session/data/mysql/connectionGroups`, {
            headers: {
                'Content-Type': 'application/json',
                'Guacamole-Token': keeperAuthToken
            }
        });

        const groups = listGroupsResponse.data;

        const groupArray = Object.values(groups);
        const group = groupArray.find(g => g.name === groupName);
        
        if (group) {
            return group.identifier;
        } else {
            return null;
        }
    } catch (error) {
        throw error;
    }
}

async function main() {
    try {
        await setupWizard(); 
        await authenticateToKeeper();

        if (addUsersOnly) {
            const { input } = await import('@inquirer/prompts');
            console.log('Adding users to existing group...');
            const groupName = targetName; 
            const groupIdentifier = await getGroupIdentifier(groupName);
            if (groupIdentifier) {
                await processUsers(groupIdentifier);
            } else {
                console.error(`Group "${groupName}" not found.`);
            }
        } else {
            await findAndProcessItem();
        }

        console.log('Completed processing.');
    } catch (err) {
        console.error('Error:', err);
    }
}

(async () => {
    await main();
})();