import 'package:flutter/material.dart';
import 'package:fairway_sniper/models/player_directory.dart';
import 'package:fairway_sniper/services/player_directory_service.dart';

/// Modal dialog for selecting players from the directory
/// Displays categories in tabs and allows multi-select with search
class PlayerSelectorModal extends StatefulWidget {
  final PlayerDirectoryService directoryService;
  final List<String> initialSelectedNames;
  final int maxPlayers;
  final String? username;
  final String? password;

  const PlayerSelectorModal({
    super.key,
    required this.directoryService,
    this.initialSelectedNames = const [],
    this.maxPlayers = 4,
    this.username,
    this.password,
  });

  /// Show the modal and return selected player names, or null if cancelled
  static Future<List<String>?> show({
    required BuildContext context,
    required PlayerDirectoryService directoryService,
    List<String> initialSelectedNames = const [],
    int maxPlayers = 4,
    String? username,
    String? password,
  }) async {
    return showDialog<List<String>>(
      context: context,
      barrierDismissible: false,
      builder: (context) => PlayerSelectorModal(
        directoryService: directoryService,
        initialSelectedNames: initialSelectedNames,
        maxPlayers: maxPlayers,
        username: username,
        password: password,
      ),
    );
  }

  @override
  State<PlayerSelectorModal> createState() => _PlayerSelectorModalState();
}

class _PlayerSelectorModalState extends State<PlayerSelectorModal>
    with SingleTickerProviderStateMixin {
  PlayerDirectory? _directory;
  bool _loading = true;
  String? _error;
  String _searchQuery = '';
  final Set<String> _selectedNames = {};
  late TabController _tabController;
  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _selectedNames.addAll(widget.initialSelectedNames);
    _loadDirectory();
  }

  @override
  void dispose() {
    _tabController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadDirectory() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final directory = await widget.directoryService.getDirectory(
        username: widget.username,
        password: widget.password,
      );
      if (directory == null) {
        setState(() {
          _error = 'Could not load player directory';
          _loading = false;
        });
        return;
      }

      setState(() {
        _directory = directory;
        _tabController = TabController(
          length: directory.categories.length + 1, // +1 for "All" tab
          vsync: this,
        );
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = 'Error loading directory: $e';
        _loading = false;
      });
    }
  }

  Future<void> _refreshDirectory() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final directory = await widget.directoryService.refresh(
        username: widget.username,
        password: widget.password,
      );
      if (directory == null) {
        setState(() {
          _error = 'Could not refresh player directory';
          _loading = false;
        });
        return;
      }

      setState(() {
        _directory = directory;
        _loading = false;
      });

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Player directory refreshed')),
        );
      }
    } catch (e) {
      setState(() {
        _error = 'Error refreshing directory: $e';
        _loading = false;
      });
    }
  }

  List<Player> _getFilteredPlayers() {
    if (_directory == null) return [];

    if (_searchQuery.isEmpty) {
      // Show players from current tab
      if (_tabController.index == 0) {
        // "All" tab
        return _directory!.getAllPlayers();
      } else {
        // Specific category tab
        final category = _directory!.categories[_tabController.index - 1];
        return category.players;
      }
    } else {
      // Search across all players
      return _directory!.searchPlayers(_searchQuery);
    }
  }

  void _togglePlayer(String playerName) {
    setState(() {
      if (_selectedNames.contains(playerName)) {
        _selectedNames.remove(playerName);
      } else {
        if (_selectedNames.length < widget.maxPlayers) {
          _selectedNames.add(playerName);
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Maximum ${widget.maxPlayers} players allowed'),
              duration: const Duration(seconds: 2),
            ),
          );
        }
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final screenSize = MediaQuery.of(context).size;
    final isNarrow = screenSize.width < 600;

    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Container(
        width: isNarrow ? screenSize.width * 0.95 : 600,
        height: isNarrow ? screenSize.height * 0.9 : 700,
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Header
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Select Players',
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.refresh),
                  onPressed: _loading ? null : _refreshDirectory,
                  tooltip: 'Refresh directory',
                ),
                IconButton(
                  icon: const Icon(Icons.close),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
            const SizedBox(height: 8),

            // Selected count
            Text(
              '${_selectedNames.length} of ${widget.maxPlayers} selected',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: _selectedNames.length >= widget.maxPlayers
                        ? Colors.orange
                        : Colors.grey[600],
                  ),
            ),
            const SizedBox(height: 16),

            // Search bar
            TextField(
              controller: _searchController,
              decoration: InputDecoration(
                hintText: 'Search players...',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _searchQuery.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: () {
                          _searchController.clear();
                          setState(() => _searchQuery = '');
                        },
                      )
                    : null,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
              onChanged: (value) {
                setState(() => _searchQuery = value);
              },
            ),
            const SizedBox(height: 16),

            // Loading or error state
            if (_loading)
              const Expanded(
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_error != null)
              Expanded(
                child: Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.error_outline,
                          size: 48, color: Colors.red[300]),
                      const SizedBox(height: 16),
                      Text(_error!, textAlign: TextAlign.center),
                      const SizedBox(height: 16),
                      ElevatedButton.icon(
                        onPressed: _loadDirectory,
                        icon: const Icon(Icons.refresh),
                        label: const Text('Retry'),
                      ),
                    ],
                  ),
                ),
              )
            else if (_directory == null)
              const Expanded(
                child: Center(child: Text('No directory available')),
              )
            else ...[
              // Category tabs
              if (_searchQuery.isEmpty)
                TabBar(
                  controller: _tabController,
                  isScrollable: true,
                  tabs: [
                    const Tab(text: 'All'),
                    ..._directory!.categories.map((cat) => Tab(text: cat.name)),
                  ],
                  onTap: (_) => setState(() {}),
                ),
              const SizedBox(height: 8),

              // Player list
              Expanded(
                child: _buildPlayerList(),
              ),
            ],

            const SizedBox(height: 16),

            // Action buttons
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('Cancel'),
                ),
                const SizedBox(width: 8),
                ElevatedButton(
                  onPressed: _selectedNames.isEmpty
                      ? null
                      : () =>
                          Navigator.of(context).pop(_selectedNames.toList()),
                  child: Text('Select ${_selectedNames.length}'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPlayerList() {
    final players = _getFilteredPlayers();

    if (players.isEmpty) {
      return Center(
        child: Text(
          _searchQuery.isNotEmpty
              ? 'No players found matching "$_searchQuery"'
              : 'No players in this category',
          style: Theme.of(context).textTheme.bodyMedium,
        ),
      );
    }

    return ListView.builder(
      itemCount: players.length,
      itemBuilder: (context, index) {
        final player = players[index];
        final isSelected = _selectedNames.contains(player.name);
        final isDisabled =
            !isSelected && _selectedNames.length >= widget.maxPlayers;

        return ListTile(
          leading: Checkbox(
            value: isSelected,
            onChanged: isDisabled
                ? null
                : (bool? value) {
                    _togglePlayer(player.name);
                  },
          ),
          title: Text(
            player.name,
            style: TextStyle(
              color: isDisabled ? Colors.grey : null,
            ),
          ),
          subtitle: Text(
            player.type.toUpperCase(),
            style: TextStyle(
              fontSize: 11,
              color: isDisabled ? Colors.grey : Colors.grey[600],
            ),
          ),
          enabled: !isDisabled,
          onTap: isDisabled ? null : () => _togglePlayer(player.name),
        );
      },
    );
  }
}
