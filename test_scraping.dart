import 'dart:convert';
import 'package:http/http.dart' as http;

/// Quick test script to check if the player directory scraping works
Future<void> main() async {
  print('🔍 Testing Player Directory Scraping...\n');
  
  // Test parameters - you'll need to replace these with real values
  const agentUrl = 'http://localhost:3001/api/brs/fetch-player-directory';
  const username = 'YOUR_USERNAME';  // Replace with your BRS username
  const password = 'YOUR_PASSWORD';  // Replace with your BRS password
  const clubGUI = 'galgorm';         // Your club identifier
  
  print('📡 Making request to agent at: $agentUrl');
  print('🏌️ Club: $clubGUI\n');
  
  try {
    final response = await http.post(
      Uri.parse(agentUrl),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'username': username,
        'password': password,
        'club': clubGUI,
        'debug': true,   // Enable debug mode for more output
        'headed': false, // Headless mode
      }),
    ).timeout(Duration(seconds: 60));
    
    print('📊 Response Status: ${response.statusCode}');
    print('📄 Response Body:\n${response.body}\n');
    
    if (response.statusCode == 200) {
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      
      if (data['success'] == true) {
        print('✅ SUCCESS! Player directory fetched');
        
        if (data.containsKey('categories')) {
          final categories = data['categories'] as List;
          print('📋 Found ${categories.length} categories:');
          
          for (var category in categories) {
            final name = category['name'];
            final players = category['players'] as List;
            print('   • $name: ${players.length} players');
            
            // Show first 5 players from each category
            if (players.isNotEmpty) {
              final preview = players.take(5).map((p) => p['name']).join(', ');
              print('     Preview: $preview${players.length > 5 ? '...' : ''}');
            }
          }
        }
      } else {
        print('❌ FAILED: ${data['error'] ?? 'Unknown error'}');
      }
    } else {
      print('❌ HTTP Error ${response.statusCode}');
    }
    
  } catch (e) {
    print('❌ ERROR: $e');
  }
}
