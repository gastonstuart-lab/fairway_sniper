import 'dart:convert';
import 'dart:async';
import 'package:http/http.dart' as http;
import 'package:fairway_sniper/models/player_directory.dart';
import 'package:fairway_sniper/services/firebase_service.dart';
import 'package:fairway_sniper/services/agent_base_url.dart';

/// Service for managing the player directory cache
/// Handles fetching from agent and caching in Firestore
class PlayerDirectoryService {
  final FirebaseService _firebaseService;

  // Cache duration - refresh if directory is older than this
  static const Duration cacheMaxAge = Duration(days: 7);

  PlayerDirectoryService({
    required FirebaseService firebaseService,
  }) : _firebaseService = firebaseService;

  /// Get the player directory, using cache if available and fresh
  /// Set forceRefresh=true to bypass cache and fetch from agent
  /// Provide username/password to fetch without requiring Firebase storage
  Future<PlayerDirectory?> getDirectory({
    bool forceRefresh = false,
    String? username,
    String? password,
  }) async {
    // Allow local mode: if credentials are provided, use a local fallback userId
    final userId = _firebaseService.currentUserId ?? 'local-user';
    final skipCache = username != null && password != null;

    // Try to load from cache first (unless forcing refresh or skipping cache because creds provided)
    if (!forceRefresh && !skipCache) {
      final cached = await _loadFromCache(userId);
      if (cached != null && !cached.isStale(cacheMaxAge)) {
        print(
            '✅ Using cached player directory (${cached.categories.length} categories)');
        return cached;
      } else if (cached != null) {
        print('⚠️ Cached directory is stale, fetching fresh data...');
      }
    }

    // Fetch fresh data from agent
    print('🔄 Fetching player directory from agent...');
    final fresh =
        await _fetchFromAgent(userId, username: username, password: password);
    if (fresh != null) {
      if (!skipCache) {
        await _saveToCache(userId, fresh);
        print(
            '✅ Player directory fetched and cached (${fresh.categories.length} categories)');
      }
    }

    return fresh;
  }

  /// Explicitly refresh the directory from the agent
  Future<PlayerDirectory?> refresh({String? username, String? password}) async {
    return getDirectory(
        forceRefresh: true, username: username, password: password);
  }

  /// Clear the cached directory
  Future<void> clearCache() async {
    final userId = _firebaseService.currentUserId;
    if (userId == null) return;

    await _firebaseService.clearPlayerDirectory(userId);
    print('✅ Player directory cache cleared');
  }

  /// Load directory from Firestore cache
  Future<PlayerDirectory?> _loadFromCache(String userId) async {
    try {
      final data = await _firebaseService.loadPlayerDirectory(userId);
      if (data == null) return null;
      return PlayerDirectory.fromFirestore(data as Map<String, dynamic>);
    } catch (e) {
      print('❌ Error loading cached player directory: $e');
      return null;
    }
  }

  /// Save directory to Firestore cache
  Future<void> _saveToCache(String userId, PlayerDirectory directory) async {
    try {
      await _firebaseService.savePlayerDirectory(userId, directory);
    } catch (e) {
      print('❌ Error saving player directory to cache: $e');
      rethrow;
    }
  }

  /// Fetch directory from agent endpoint
  Future<PlayerDirectory?> _fetchFromAgent(String userId,
      {String? username, String? password}) async {
    try {
      // Use provided credentials or load from Firebase
      String? finalUsername = username;
      String? finalPassword = password;

      if (finalUsername == null || finalPassword == null) {
        final credentials = await _firebaseService.loadBRSCredentials(userId);
        if (credentials == null) {
          print(
              '❌ Cannot fetch player directory: No BRS credentials provided or saved');
          return null;
        }
        finalUsername = credentials['username'];
        finalPassword = credentials['password'];
      }

      if (finalUsername == null || finalPassword == null) {
        print('❌ Cannot fetch player directory: Invalid credentials');
        return null;
      }

      // Do not log credentials.

      final agentBaseUrl = await getAgentBaseUrl();

      // Make request to agent
      final url = Uri.parse('$agentBaseUrl/api/brs/player-directory');
      print('🧭 [PlayerDirectory] Base URL: $agentBaseUrl');
      print('🧭 [PlayerDirectory] POST: $url');
      final response = await http
          .post(
            url,
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'userId': userId,
              'username': finalUsername,
              'password': finalPassword,
            }),
          )
          .timeout(
            const Duration(seconds: 90),
            onTimeout: () => throw TimeoutException(
              'Player directory fetch took too long (>90s)',
              const Duration(seconds: 90),
            ),
          );

      if (response.statusCode != 200) {
        print('❌ Agent returned error: ${response.statusCode}');
        print('   Body: ${response.body}');
        return null;
      }

      final data = jsonDecode(response.body) as Map<String, dynamic>;
      if (data['success'] != true) {
        print('❌ Agent request failed: ${data['error'] ?? 'Unknown error'}');
        return null;
      }

      final count = data['count'];
      print('✅ [PlayerDirectory] Response count: $count');

      // Parse response into PlayerDirectory
      final categoriesData = data['categories'] as List<dynamic>;
      final categories = categoriesData
          .map((c) => PlayerCategory.fromMap(c as Map<String, dynamic>))
          .toList();

      final currentUserName = data['currentUserName'] as String?;
      if (currentUserName != null) {
        print('👤 Current user: $currentUserName');
      }

      return PlayerDirectory(
        categories: categories,
        fetchedAt: DateTime.now(),
        currentUserName: currentUserName,
      );
    } catch (e) {
      print('❌ Error fetching player directory from agent: $e');
      return null;
    }
  }
}
