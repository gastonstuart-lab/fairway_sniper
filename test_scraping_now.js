// Quick test of player directory scraping
const http = require('http');

console.log('==================================');
console.log('Player Directory Scraping Test');
console.log('==================================\n');

// Step 1: Check if agent is running
console.log('[1/3] Checking if agent is running...');

const healthCheck = new Promise((resolve, reject) => {
  const req = http.get('http://localhost:3000/health', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      if (res.statusCode === 200) {
        console.log('✅ Agent is running!');
        console.log(`    Status: ${JSON.parse(data).status}\n`);
        resolve();
      } else {
        reject(new Error(`Health check failed: ${res.statusCode}`));
      }
    });
  });
  req.on('error', reject);
  req.setTimeout(5000);
});

healthCheck
  .then(() => {
    // Step 2: Test player directory endpoint
    console.log('[2/3] Fetching player directory...');
    console.log('    URL: http://localhost:3000/api/brs/fetch-player-directory');
    console.log('    Club: galgorm');
    console.log('    Debug: enabled\n');

    const postData = JSON.stringify({
      username: '12390624',
      password: 'cantona7777',
      club: 'galgorm',
      debug: true,
      headed: false
    });

    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/brs/fetch-player-directory',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': postData.length
      },
      timeout: 60000
    };

    const startTime = Date.now();
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        
        if (res.statusCode === 200) {
          console.log(`✅ SUCCESS! Request completed in ${duration}s\n`);
          
          // Step 3: Display results
          console.log('[3/3] Results:\n');
          
          try {
            const response = JSON.parse(data);
            
            if (response.success) {
              console.log('📊 Summary:');
              console.log(`    Generated at: ${response.generatedAt}`);
              console.log(`    Categories: ${response.categories.length}\n`);

              let totalPlayers = 0;
              response.categories.forEach(category => {
                totalPlayers += category.players.length;
                console.log(`📁 Category: ${category.name}`);
                console.log(`   Players: ${category.players.length}`);
                
                // Show first 10 players as sample
                const sample = category.players.slice(0, 10);
                sample.forEach(player => {
                  console.log(`      • ${player.name}`);
                });
                
                if (category.players.length > 10) {
                  console.log(`      ... and ${category.players.length - 10} more`);
                }
                console.log('');
              });

              console.log('=====================================');
              console.log(`✅ TOTAL PLAYERS FOUND: ${totalPlayers}`);
              console.log('=====================================');
              
            } else {
              console.log('❌ Request succeeded but returned failure:');
              console.log(`    Error: ${response.error}`);
              process.exit(1);
            }
          } catch (e) {
            console.log('❌ Failed to parse response:');
            console.log(`    Error: ${e.message}`);
            console.log(`    Response: ${data}`);
            process.exit(1);
          }
          
        } else {
          console.log(`❌ Request failed with status ${res.statusCode}`);
          console.log(`    Response: ${data}`);
          process.exit(1);
        }
      });
    });

    req.on('error', (e) => {
      console.log('❌ Request failed!');
      console.log(`    Error: ${e.message}`);
      process.exit(1);
    });

    req.write(postData);
    req.end();
  })
  .catch((e) => {
    console.log('❌ Agent is NOT running!');
    console.log(`    Error: ${e.message}`);
    console.log('    Please start the agent first with: cd agent && node index.js');
    process.exit(1);
  });
