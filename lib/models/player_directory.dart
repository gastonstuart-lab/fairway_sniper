import 'package:cloud_firestore/cloud_firestore.dart';

/// Represents a player in the directory
class Player {
  final String name;
  final String id;
  final String type;

  Player({
    required this.name,
    required this.id,
    required this.type,
  });

  factory Player.fromMap(Map<String, dynamic> map) {
    return Player(
      name: map['name'] as String,
      id: map['id'] as String,
      type: map['type'] as String,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'name': name,
      'id': id,
      'type': type,
    };
  }
}

/// Represents a category of players (e.g., "You", "Recent", "Buddies", "Guests", "Members")
class PlayerCategory {
  final String name;
  final List<Player> players;

  PlayerCategory({
    required this.name,
    required this.players,
  });

  factory PlayerCategory.fromMap(Map<String, dynamic> map) {
    final playersData = map['players'] as List<dynamic>;
    final players = playersData
        .map((p) => Player.fromMap(p as Map<String, dynamic>))
        .toList();

    return PlayerCategory(
      name: map['name'] as String,
      players: players,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'name': name,
      'players': players.map((p) => p.toMap()).toList(),
    };
  }
}

/// Represents the complete player directory with all categories
class PlayerDirectory {
  final List<PlayerCategory> categories;
  final DateTime fetchedAt;
  final String? currentUserName; // Name of the logged-in user (from BRS Player 1 slot)

  PlayerDirectory({
    required this.categories,
    required this.fetchedAt,
    this.currentUserName,
  });

  factory PlayerDirectory.fromFirestore(Map<String, dynamic> data) {
    final categoriesData = data['categories'] as List<dynamic>;
    final categories = categoriesData
        .map((c) => PlayerCategory.fromMap(c as Map<String, dynamic>))
        .toList();

    final fetchedAtTimestamp = data['fetchedAt'] as Timestamp;

    return PlayerDirectory(
      categories: categories,
      fetchedAt: fetchedAtTimestamp.toDate(),
      currentUserName: data['currentUserName'] as String?,
    );
  }

  Map<String, dynamic> toFirestore() {
    return {
      'categories': categories.map((c) => c.toMap()).toList(),
      'fetchedAt': Timestamp.fromDate(fetchedAt),
      if (currentUserName != null) 'currentUserName': currentUserName,
    };
  }

  /// Get all players across all categories as a flat list
  List<Player> getAllPlayers() {
    return categories.expand((category) => category.players).toList();
  }

  /// Search for players by name (case-insensitive)
  List<Player> searchPlayers(String query) {
    if (query.isEmpty) return getAllPlayers();
    
    final lowerQuery = query.toLowerCase();
    return getAllPlayers()
        .where((player) => player.name.toLowerCase().contains(lowerQuery))
        .toList();
  }

  /// Get players from a specific category
  List<Player> getPlayersInCategory(String categoryName) {
    final category = categories.firstWhere(
      (c) => c.name.toLowerCase() == categoryName.toLowerCase(),
      orElse: () => PlayerCategory(name: '', players: []),
    );
    return category.players;
  }

  /// Check if the directory is stale (older than specified duration)
  bool isStale(Duration maxAge) {
    final now = DateTime.now();
    return now.difference(fetchedAt) > maxAge;
  }
}
