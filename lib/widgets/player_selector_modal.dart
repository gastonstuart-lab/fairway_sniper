import 'package:flutter/material.dart';
import 'package:fairway_sniper/models/player_directory.dart';
import 'package:fairway_sniper/services/player_directory_service.dart';
import 'package:fairway_sniper/services/agent_base_url.dart';

/// Modal dialog for selecting players from the directory
/// Displays categories in tabs and allows multi-select with search
class PlayerSelectorModal extends StatefulWidget {
  final PlayerDirectoryService directoryService;
  final List<String> initialSelectedNames;
  final List<String> initialSelectedIds;
  final bool returnIds;
  final List<String> allowedCategories;
  final int maxPlayers;
  final String? username;
  final String? password;

  const PlayerSelectorModal({
    super.key,
    required this.directoryService,
    this.initialSelectedNames = const [],
    this.initialSelectedIds = const [],
    this.returnIds = false,
    this.allowedCategories = const [],
    this.maxPlayers = 4,
    this.username,
    this.password,
  });

  /// Show the modal and return selected player names, or null if cancelled
  static Future<List<String>?> show({
    required BuildContext context,
    required PlayerDirectoryService directoryService,
    List<String> initialSelectedNames = const [],
    List<String> initialSelectedIds = const [],
    bool returnIds = false,
    List<String> allowedCategories = const [],
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
        initialSelectedIds: initialSelectedIds,
        returnIds: returnIds,
        allowedCategories: allowedCategories,
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
  final Set<String> _selectedIds = {};
  final Set<String> _pendingSelectedNames = {};
  late TabController _tabController;
  final TextEditingController _searchController = TextEditingController();
  String? _currentUserName;
  
  String _agentHelpText() {
    return 'If you are on Android emulator, use http://10.0.2.2:3000. '
        'If you are on a physical phone, use your PC LAN IP (e.g. http://192.168.x.x:3000).';
  }

  @override
  void initState() {
    super.initState();
    if (widget.returnIds) {
      _selectedIds.addAll(widget.initialSelectedIds);
    } else {
      _pendingSelectedNames.addAll(widget.initialSelectedNames);
    }
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
      final baseUrl = await getAgentBaseUrl();
      final directory = await widget.directoryService.getDirectory(
        username: widget.username,
        password: widget.password,
      );
      if (directory == null) {
        setState(() {
          _error =
              'Could not load player directory from $baseUrl. ${_agentHelpText()}';
          _loading = false;
        });
        return;
      }

      final displayCategories = _filterCategories(directory);
      _currentUserName = directory.currentUserName;
      if (_pendingSelectedNames.isNotEmpty) {
        final byName = <String, String>{};
        for (final player in directory.getAllPlayers()) {
          if (_isCurrentUser(player)) continue;
          byName[player.name] = player.id;
        }
        for (final name in _pendingSelectedNames) {
          final id = byName[name];
          if (id != null) {
            _selectedIds.add(id);
          }
        }
        _pendingSelectedNames.clear();
      }

      setState(() {
        _directory = directory;
        _tabController = TabController(
          length: displayCategories.length + 1, // +1 for "All" tab
          vsync: this,
        );
        _loading = false;
      });
    } catch (e) {
      final baseUrl = await getAgentBaseUrl();
      setState(() {
        _error =
            'Error loading directory from $baseUrl: $e. ${_agentHelpText()}';
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
      final baseUrl = await getAgentBaseUrl();
      final directory = await widget.directoryService.refresh(
        username: widget.username,
        password: widget.password,
      );
      if (directory == null) {
        setState(() {
          _error =
              'Could not refresh player directory from $baseUrl. ${_agentHelpText()}';
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
      final baseUrl = await getAgentBaseUrl();
      setState(() {
        _error =
            'Error refreshing directory from $baseUrl: $e. ${_agentHelpText()}';
        _loading = false;
      });
    }
  }

  List<PlayerCategory> _filterCategories(PlayerDirectory directory) {
    if (widget.allowedCategories.isEmpty) {
      return directory.categories;
    }
    final allowed = widget.allowedCategories
        .map((c) => c.toLowerCase())
        .toSet();
    final filtered = directory.categories
        .where((c) => allowed.contains(c.name.toLowerCase()))
        .toList();
    if (filtered.isEmpty) {
      return directory.categories;
    }
    return filtered;
  }

  List<Player> _getFilteredPlayers() {
    if (_directory == null) return [];

    final displayCategories = _filterCategories(_directory!);
    if (_searchQuery.isEmpty) {
      // Show players from current tab
      if (_tabController.index == 0) {
        // "All" tab
        return displayCategories
            .expand((category) => category.players)
            .where((player) => !_isCurrentUser(player))
            .toList();
      } else {
        // Specific category tab
        final category = displayCategories[_tabController.index - 1];
        return category.players.where((player) => !_isCurrentUser(player)).toList();
      }
    } else {
      // Search across displayed categories only
      final lowerQuery = _searchQuery.toLowerCase();
      return displayCategories
          .expand((category) => category.players)
          .where((player) => !_isCurrentUser(player))
          .where((player) => player.name.toLowerCase().contains(lowerQuery))
          .toList();
    }
  }

  bool _isCurrentUser(Player player) {
    final current = _currentUserName;
    if (current == null || current.isEmpty) return false;
    return player.name.trim().toLowerCase() == current.trim().toLowerCase();
  }

  void _togglePlayer(Player player) {
    setState(() {
      if (_selectedIds.contains(player.id)) {
        _selectedIds.remove(player.id);
      } else {
        if (_selectedIds.length < widget.maxPlayers) {
          _selectedIds.add(player.id);
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
              '${_selectedIds.length} of ${widget.maxPlayers} selected',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: _selectedIds.length >= widget.maxPlayers
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
                    ..._filterCategories(_directory!)
                        .map((cat) => Tab(text: cat.name)),
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
                  onPressed: _selectedIds.isEmpty
                      ? null
                      : () {
                          if (widget.returnIds) {
                            Navigator.of(context)
                                .pop(_selectedIds.toList());
                            return;
                          }
                          final map = <String, String>{};
                          for (final player in _directory!.getAllPlayers()) {
                            map[player.id] = player.name;
                          }
                          final names = _selectedIds
                              .map((id) => map[id] ?? id)
                              .toList();
                          Navigator.of(context).pop(names);
                        },
                  child: Text('Select ${_selectedIds.length}'),
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
        final isSelected = _selectedIds.contains(player.id);
        final isDisabled =
            !isSelected && _selectedIds.length >= widget.maxPlayers;

        return ListTile(
          leading: Checkbox(
            value: isSelected,
            onChanged: isDisabled
                ? null
                : (bool? value) {
                    _togglePlayer(player);
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
          onTap: isDisabled ? null : () => _togglePlayer(player),
        );
      },
    );
  }
}
