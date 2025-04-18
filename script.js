// BLE UART Service UUIDs (Nordic UART Service)
const UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const UART_TX_CHARACTERISTIC_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // RX on the device
const UART_RX_CHARACTERISTIC_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // TX on the device

let bleDevice = null;
let bleServer = null;
let rxCharacteristic = null;
let txCharacteristic = null;
let isConnected = false;

// Data storage
const maxDataPoints = 50;
const altitudeData = {
    timestamps: [],
    values: []
};
const accelData = {
    timestamps: [],
    values: []
};

// Chart references
let altitudeChart = null;
let accelChart = null;

// DOM elements
const connectBtn = document.getElementById('connectBtn');
const connectionStatus = document.getElementById('connectionStatus');
const currentAltitude = document.getElementById('currentAltitude');
const elevationChange = document.getElementById('elevationChange');
const motionStatus = document.getElementById('motionStatus');
const ledRed = document.getElementById('ledRed');
const ledGreen = document.getElementById('ledGreen');
const ledBlue = document.getElementById('ledBlue');
const logContainer = document.getElementById('logContainer');
const clearLogBtn = document.getElementById('clearLogBtn');
const calibrateBtn = document.getElementById('calibrateBtn');
const testSoundBtn = document.getElementById('testSoundBtn');
const configBtn = document.getElementById('configBtn');
const configPanel = document.getElementById('configPanel');
const closeConfigBtn = document.getElementById('closeConfigBtn');
const saveConfigBtn = document.getElementById('saveConfigBtn');
const getConfigBtn = document.getElementById('getConfigBtn');

// Range input value displays
document.getElementById('sounderFreq').addEventListener('input', function() {
    document.getElementById('sounderFreqValue').textContent = this.value + ' Hz';
});
document.getElementById('sounderDuration').addEventListener('input', function() {
    document.getElementById('sounderDurationValue').textContent = this.value + ' ms';
});

// Check if Web Bluetooth is available
if (!navigator.bluetooth) {
    addLogEntry('Web Bluetooth is not supported in this browser!', true);
    connectBtn.disabled = true;
    connectBtn.textContent = 'Bluetooth Not Supported';
}

// Initialize the page
function initialize() {
    // Set up event listeners
    connectBtn.addEventListener('click', toggleConnection);
    clearLogBtn.addEventListener('click', clearLog);
    calibrateBtn.addEventListener('click', calibrateDevice);
    testSoundBtn.addEventListener('click', testSound);
    configBtn.addEventListener('click', showConfigPanel);
    closeConfigBtn.addEventListener('click', hideConfigPanel);
    saveConfigBtn.addEventListener('click', saveConfiguration);
    getConfigBtn.addEventListener('click', getConfiguration);
    
    // Initialize the charts
    initCharts();
    
    // Disable buttons until connected
    calibrateBtn.disabled = true;
    testSoundBtn.disabled = true;
    configBtn.disabled = true;
    
    addLogEntry('Page loaded. Ready to connect.');
}

// Initialize the charts
function initCharts() {
    // Altitude chart
    const altCtx = document.getElementById('altitudeChart').getContext('2d');
    altitudeChart = new Chart(altCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Altitude (m)',
                data: [],
                borderColor: 'rgba(75, 192, 192, 1)',
                backgroundColor: 'rgba(75, 192, 192, 0.2)',
                borderWidth: 2,
                tension: 0.2,
                fill: true,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: false
                },
                x: {
                    display: false
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            },
            animation: {
                duration: 0 // Disables animation for better performance
            }
        }
    });
    
    // Acceleration chart
    const accelCtx = document.getElementById('accelChart').getContext('2d');
    accelChart = new Chart(accelCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Acceleration (G)',
                data: [],
                borderColor: 'rgba(255, 99, 132, 1)',
                backgroundColor: 'rgba(255, 99, 132, 0.2)',
                borderWidth: 2,
                tension: 0.2,
                fill: true,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: false
                },
                x: {
                    display: false
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            },
            animation: {
                duration: 0 // Disables animation for better performance
            }
        }
    });
}

// Toggle BLE connection
async function toggleConnection() {
    if (isConnected) {
        disconnectFromDevice();
    } else {
        connectToDevice();
    }
}

// Connect to BLE device
async function connectToDevice() {
    try {
        addLogEntry('Requesting Bluetooth device...');
        
        // Request the BLE device
        bleDevice = await navigator.bluetooth.requestDevice({
            filters: [
                { services: [UART_SERVICE_UUID] }
                // Alternatively, you can use name filters if your device advertises a specific name
                // { name: 'AltMonitor' }
            ],
            optionalServices: [UART_SERVICE_UUID]
        });
        
        addLogEntry(`Device selected: ${bleDevice.name || 'Unknown device'}`);
        
        // Add event listener for disconnection
        bleDevice.addEventListener('gattserverdisconnected', onDisconnected);
        
        // Connect to the GATT server
        addLogEntry('Connecting to GATT server...');
        bleServer = await bleDevice.gatt.connect();
        
        // Get the UART service
        addLogEntry('Getting UART service...');
        const service = await bleServer.getPrimaryService(UART_SERVICE_UUID);
        
        // Get the RX and TX characteristics
        addLogEntry('Getting UART characteristics...');
        rxCharacteristic = await service.getCharacteristic(UART_RX_CHARACTERISTIC_UUID);
        txCharacteristic = await service.getCharacteristic(UART_TX_CHARACTERISTIC_UUID);
        
        // Start notifications on RX characteristic (device -> web app)
        await rxCharacteristic.startNotifications();
        rxCharacteristic.addEventListener('characteristicvaluechanged', handleNotifications);
        
        isConnected = true;
        updateConnectionStatus(true);
        addLogEntry('Connected successfully!');
        
        // Get current configuration
        setTimeout(getConfiguration, 1000); // Wait a bit to ensure stable connection
        
    } catch (error) {
        addLogEntry(`Connection error: ${error}`, true);
        disconnectFromDevice();
    }
}

// Handle incoming BLE notifications
function handleNotifications(event) {
    const value = event.target.value;
    const decoder = new TextDecoder();
    const data = decoder.decode(value);
    
    // Debug - output raw data bytes to console
    console.log("Raw BLE data received:");
    const bytes = new Uint8Array(value.buffer);
    console.log(Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' '));
    console.log(`Decoded as text: "${data}"`);
    
    // Add to log
    addLogEntry(`Data: ${data}`);
    
    // Process the data
    processSerialData(data);
}

// Process the serial data from the device
function processSerialData(data) {
    // Handle configuration data
    if (data.startsWith("CFG:")) {
        processConfigData(data.substring(4));
        return;
    }
    
    // Handle the different data types based on prefix
    if (data.startsWith("A:")) {
        // Altitude data
        const altitude = parseFloat(data.substring(2));
        if (!isNaN(altitude)) {
            currentAltitude.textContent = `${altitude.toFixed(2)} m`;
            addAltitudeDataPoint(altitude); // Add to chart
        }
    } 
    else if (data.startsWith("C:")) {
        // Change data
        const change = parseFloat(data.substring(2));
        if (!isNaN(change)) {
            elevationChange.textContent = `${change.toFixed(2)} cm`;
            
            // Add classes for styling based on change value
            if (change > 0) {
                elevationChange.classList.add('rising');
                elevationChange.classList.remove('falling');
                ledRed.classList.add('active');
                ledGreen.classList.remove('active');
            } else if (change < 0) {
                elevationChange.classList.add('falling');
                elevationChange.classList.remove('rising');
                ledRed.classList.remove('active');
                ledGreen.classList.add('active');
            } else {
                elevationChange.classList.remove('rising', 'falling');
                ledRed.classList.remove('active');
                ledGreen.classList.remove('active');
            }
        }
    }
    else if (data.startsWith("M:")) {
        // Motion data
        const motion = data.substring(2);
        motionStatus.textContent = motion;
        
        // Update drift LED based on stability
        ledBlue.classList.toggle('active', motion === 'DRIFT');
    }
    else if (data.startsWith("G:")) {
        // Acceleration data
        const accel = parseFloat(data.substring(2));
        if (!isNaN(accel)) {
            addAccelDataPoint(accel);
        }
    }
    // Fallback for non-prefixed data (original format)
    else {
        // Check for altitude data format in the original format
        const altitudeMatch = data.match(/Altitude: ([0-9.]+)/);
        
        if (altitudeMatch) {
            const altitude = parseFloat(altitudeMatch[1]);
            currentAltitude.textContent = `${altitude.toFixed(2)} m`;
            addAltitudeDataPoint(altitude);
        }
    }
}

// Process config data
function processConfigData(data) {
    try {
        const config = JSON.parse(data);
        
        // Update input fields with received values
        document.getElementById('seaLevelPressure').value = config.SEA_LEVEL_PRESSURE || 1013.25;
        document.getElementById('movementThreshold').value = config.MOVEMENT_THRESHOLD * 100 || 10;
        document.getElementById('accelThreshold').value = config.IMU_ACCEL_THRESHOLD || 0.15;
        document.getElementById('sounderType').value = config.SOUNDER_TYPE || 2;
        document.getElementById('sounderFreq').value = config.SOUNDER_BASE_FREQ || 800;
        document.getElementById('sounderDuration').value = config.SOUNDER_DURATION || 100;
        
        // Update displayed values for range inputs
        document.getElementById('sounderFreqValue').textContent = `${document.getElementById('sounderFreq').value} Hz`;
        document.getElementById('sounderDurationValue').textContent = `${document.getElementById('sounderDuration').value} ms`;
        
        addLogEntry("Configuration loaded from device");
    } catch (error) {
        addLogEntry(`Error parsing configuration: ${error}`, true);
    }
}

// Add an altitude data point to the chart
function addAltitudeDataPoint(altitude) {
    const now = new Date();
    const timestamp = now.toLocaleTimeString();
    
    // Add new data
    altitudeData.timestamps.push(timestamp);
    altitudeData.values.push(altitude);
    
    // Limit the number of data points
    if (altitudeData.timestamps.length > maxDataPoints) {
        altitudeData.timestamps.shift();
        altitudeData.values.shift();
    }
    
    // Update chart
    altitudeChart.data.labels = altitudeData.timestamps;
    altitudeChart.data.datasets[0].data = altitudeData.values;
    altitudeChart.update();
}

// Add an acceleration data point to the chart
function addAccelDataPoint(accel) {
    const now = new Date();
    const timestamp = now.toLocaleTimeString();
    
    // Add new data
    accelData.timestamps.push(timestamp);
    accelData.values.push(accel);
    
    // Limit the number of data points
    if (accelData.timestamps.length > maxDataPoints) {
        accelData.timestamps.shift();
        accelData.values.shift();
    }
    
    // Update chart
    accelChart.data.labels = accelData.timestamps;
    accelChart.data.datasets[0].data = accelData.values;
    accelChart.update();
}

// Handle device disconnection
function onDisconnected() {
    isConnected = false;
    updateConnectionStatus(false);
    addLogEntry('Device disconnected.', true);
    
    // Reset device-related variables
    bleServer = null;
    rxCharacteristic = null;
    txCharacteristic = null;
}

// Disconnect from the device
function disconnectFromDevice() {
    try {
        connectBtn.classList.add('disconnecting');
        connectBtn.textContent = 'Disconnecting...';
        
        if (bleDevice && bleDevice.gatt.connected) {
            bleDevice.gatt.disconnect();
        } else {
            onDisconnected();
        }
    } catch (error) {
        addLogEntry(`Disconnection error: ${error}`, true);
        updateConnectionStatus(false);
    }
}

// Update the connection status display
function updateConnectionStatus(connected) {
    isConnected = connected;
    
    if (connected) {
        connectionStatus.textContent = 'Connected';
        connectionStatus.classList.add('connected');
        connectBtn.textContent = 'Disconnect';
        calibrateBtn.disabled = false;
        testSoundBtn.disabled = false;
        configBtn.disabled = false;
    } else {
        connectionStatus.textContent = 'Disconnected';
        connectionStatus.classList.remove('connected');
        connectBtn.textContent = 'Connect to Device';
        connectBtn.classList.remove('disconnecting');
        calibrateBtn.disabled = true;
        testSoundBtn.disabled = true;
        configBtn.disabled = true;
        
        // Reset LEDs
        ledRed.classList.remove('active');
        ledGreen.classList.remove('active');
        ledBlue.classList.remove('active');
        
        // Hide config panel if shown
        hideConfigPanel();
    }
}

// Add an entry to the log
function addLogEntry(message, isError = false) {
    const now = new Date();
    const timestamp = now.toLocaleTimeString();
    
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry';
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'time-stamp';
    timeSpan.textContent = timestamp;
    
    const messageSpan = document.createElement('span');
    messageSpan.textContent = message;
    if (isError) {
        messageSpan.style.color = 'red';
    }
    
    logEntry.appendChild(timeSpan);
    logEntry.appendChild(messageSpan);
    
    logContainer.appendChild(logEntry);
    logContainer.scrollTop = logContainer.scrollHeight;
    
    // Limit log entries to prevent memory issues
    while (logContainer.children.length > 100) {
        logContainer.removeChild(logContainer.firstChild);
    }
}

// Clear the log
function clearLog() {
    while (logContainer.firstChild) {
        logContainer.removeChild(logContainer.firstChild);
    }
    addLogEntry('Log cleared.');
}

// Send a command to the Arduino with chunking support
async function sendCommand(command) {
    if (!isConnected || !txCharacteristic) {
        addLogEntry('Not connected to device', true);
        return false;
    }
    
    try {
        const encoder = new TextEncoder();
        
        // Check if command is too large for a single BLE packet (20 bytes max)
        if (command.length <= 20) {
            // Can send in one packet
            await txCharacteristic.writeValue(encoder.encode(command));
            addLogEntry(`Command sent: ${command}`);
        } else {
            // Need to split into chunks for longer commands (especially SET_CONFIG)
            addLogEntry(`Sending command in chunks: ${command.substring(0, 20)}...`);
            
            // For SET_CONFIG commands, we'll use a special format
            if (command.startsWith("SET_CONFIG:")) {
                const prefix = "SC:"; // Shorter prefix to save space
                const jsonData = command.substring(11); // Extract the JSON part
                
                // Send start marker with length
                await txCharacteristic.writeValue(encoder.encode(`${prefix}START:${jsonData.length}`));
                await new Promise(resolve => setTimeout(resolve, 50));
                
                // Send data in chunks
                const chunkSize = 18; // Leave room for index markers
                const chunks = Math.ceil(jsonData.length / chunkSize);
                
                for (let i = 0; i < chunks; i++) {
                    const chunk = jsonData.substring(i * chunkSize, (i + 1) * chunkSize);
                    const chunkMsg = `${prefix}${i}:${chunk}`;
                    await txCharacteristic.writeValue(encoder.encode(chunkMsg));
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
                
                // Send end marker
                await txCharacteristic.writeValue(encoder.encode(`${prefix}END`));
                addLogEntry(`Sent configuration data in ${chunks} chunks`);
            } else {
                // For other commands that might be long
                for (let i = 0; i < command.length; i += 20) {
                    const chunk = command.substring(i, i + 20);
                    await txCharacteristic.writeValue(encoder.encode(chunk));
                    await new Promise(resolve => setTimeout(resolve, 20));
                }
            }
        }
        return true;
    } catch (error) {
        addLogEntry(`Error sending command: ${error}`, true);
        return false;
    }
}

// Calibrate the device
async function calibrateDevice() {
    if (await sendCommand("CALIBRATE")) {
        addLogEntry('Calibration requested. Keep device still...');
    }
}

// Test the device sound
async function testSound() {
    if (await sendCommand("SOUND")) {
        addLogEntry('Sound test requested.');
    }
}

// Show configuration panel
function showConfigPanel() {
    configPanel.classList.remove('hidden');
}

// Hide configuration panel
function hideConfigPanel() {
    configPanel.classList.add('hidden');
}

// Get current configuration from the device
async function getConfiguration() {
    if (await sendCommand("GET_CONFIG")) {
        addLogEntry('Requesting device configuration...');
    }
}

// Save configuration to the device
async function saveConfiguration() {
    if (!isConnected || !txCharacteristic) {
        addLogEntry('Not connected to device - cannot save configuration', true);
        return;
    }

    addLogEntry('Preparing to send configuration to device...');
    
    // Gather configuration values
    const config = {
        SEA_LEVEL_PRESSURE: parseFloat(document.getElementById('seaLevelPressure').value),
        MOVEMENT_THRESHOLD: parseFloat(document.getElementById('movementThreshold').value) / 100, // Convert from cm to m
        IMU_ACCEL_THRESHOLD: parseFloat(document.getElementById('accelThreshold').value),
        SOUNDER_TYPE: parseInt(document.getElementById('sounderType').value),
        SOUNDER_BASE_FREQ: parseInt(document.getElementById('sounderFreq').value),
        SOUNDER_DURATION: parseInt(document.getElementById('sounderDuration').value)
    };
    
    // Validate values - ensure they're valid numbers
    for (const [key, value] of Object.entries(config)) {
        if (isNaN(value)) {
            addLogEntry(`Error: ${key} has invalid value. Please check your inputs.`, true);
            return;
        }
    }
    
    // Convert to JSON and send
    const configJson = JSON.stringify(config);
    addLogEntry(`Configuration data: ${configJson}`);
    
    try {
        // Disable the save button during transmission
        saveConfigBtn.disabled = true;
        saveConfigBtn.textContent = "Sending...";
        
        // Send the configuration
        const command = `SET_CONFIG:${configJson}`;
        const success = await sendCommand(command);
        
        if (success) {
            addLogEntry('Configuration sent to device.');
            hideConfigPanel();
            
            // Request the current configuration to verify changes were applied
            setTimeout(async () => {
                await sendCommand("GET_CONFIG");
                addLogEntry('Verifying configuration changes...');
            }, 1000);
        } else {
            addLogEntry('Failed to send configuration to device.', true);
        }
    } catch (error) {
        addLogEntry(`Error during configuration: ${error.message}`, true);
    } finally {
        // Re-enable the save button
        saveConfigBtn.disabled = false;
        saveConfigBtn.textContent = "Save Configuration";
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', initialize);
