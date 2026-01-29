import 'package:flutter/material.dart';

/// Widget for displaying and editing a list of selected player names
/// Shows players with remove buttons and allows reordering
class PlayerListEditor extends StatefulWidget {
  final List<String> playerNames;
  final Map<String, String>? playerLabels;
  final Function(List<String>) onPlayersChanged;
  final VoidCallback onAddPlayers;
  final int maxPlayers;
  final bool readOnly;

  const PlayerListEditor({
    super.key,
    required this.playerNames,
    this.playerLabels,
    required this.onPlayersChanged,
    required this.onAddPlayers,
    this.maxPlayers = 4,
    this.readOnly = false,
  });

  @override
  State<PlayerListEditor> createState() => _PlayerListEditorState();
}

class _PlayerListEditorState extends State<PlayerListEditor> {
  void _removePlayer(int index) {
    if (widget.readOnly) return;

    final updated = List<String>.from(widget.playerNames);
    updated.removeAt(index);
    widget.onPlayersChanged(updated);
  }

  void _reorderPlayers(int oldIndex, int newIndex) {
    if (widget.readOnly) return;

    if (newIndex > oldIndex) {
      newIndex -= 1;
    }

    final updated = List<String>.from(widget.playerNames);
    final player = updated.removeAt(oldIndex);
    updated.insert(newIndex, player);
    widget.onPlayersChanged(updated);
  }

  @override
  Widget build(BuildContext context) {
    final isEmpty = widget.playerNames.isEmpty;
    final canAdd = widget.playerNames.length < widget.maxPlayers;

    // Debug output
    print('📋 PlayerListEditor: playerNames = ${widget.playerNames}');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Header with count
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              'Selected Players (${widget.playerNames.length}/${widget.maxPlayers})',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            if (!widget.readOnly && canAdd)
              TextButton.icon(
                onPressed: widget.onAddPlayers,
                icon: const Icon(Icons.add),
                label: Text(isEmpty ? 'Add Players' : 'Add More'),
              ),
          ],
        ),
        const SizedBox(height: 8),

        // Empty state
        if (isEmpty)
          Container(
            padding: const EdgeInsets.all(32),
            decoration: BoxDecoration(
              border: Border.all(color: Colors.grey[300]!),
              borderRadius: BorderRadius.circular(8),
              color: Colors.grey[50],
            ),
            child: Column(
              children: [
                Icon(Icons.people_outline, size: 48, color: Colors.grey[400]),
                const SizedBox(height: 16),
                Text(
                  'No players selected',
                  style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                        color: Colors.grey[600],
                      ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Tap "Add Players" to select from directory',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Colors.grey[500],
                      ),
                  textAlign: TextAlign.center,
                ),
                if (!widget.readOnly) ...[
                  const SizedBox(height: 16),
                  ElevatedButton.icon(
                    onPressed: widget.onAddPlayers,
                    icon: const Icon(Icons.add),
                    label: const Text('Add Players'),
                  ),
                ],
              ],
            ),
          )
        // Player list (reorderable if not read-only)
        else if (widget.readOnly)
          _buildReadOnlyList()
        else
          _buildReorderableList(),

        // Help text
        if (!isEmpty && !widget.readOnly)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              'Drag to reorder • Tap × to remove',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Colors.grey[600],
                    fontStyle: FontStyle.italic,
                  ),
              textAlign: TextAlign.center,
            ),
          ),
      ],
    );
  }

  Widget _buildReadOnlyList() {
    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: Colors.grey[300]!),
        borderRadius: BorderRadius.circular(8),
      ),
      child: ListView.separated(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        itemCount: widget.playerNames.length,
        separatorBuilder: (context, index) => Divider(
          height: 1,
          color: Colors.grey[300],
        ),
        itemBuilder: (context, index) {
          return ListTile(
            leading: CircleAvatar(
              backgroundColor: Colors.blue[100],
              child: Text(
                '${index + 1}',
                style: TextStyle(
                  color: Colors.blue[900],
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
            title: Text(
              widget.playerLabels?[widget.playerNames[index]] ??
                  widget.playerNames[index],
              style: const TextStyle(
                color: Colors.black87,
                fontSize: 16,
                fontWeight: FontWeight.w500,
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildReorderableList() {
    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: Colors.grey[300]!),
        borderRadius: BorderRadius.circular(8),
      ),
      child: ReorderableListView.builder(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        onReorder: _reorderPlayers,
        itemCount: widget.playerNames.length,
        proxyDecorator: (child, index, animation) {
          return AnimatedBuilder(
            animation: animation,
            builder: (context, child) {
              return Material(
                elevation: 8,
                color: Colors.transparent,
                child: child,
              );
            },
            child: child,
          );
        },
        itemBuilder: (context, index) {
          final playerName = widget.playerNames[index];
          final displayName =
              widget.playerLabels?[playerName] ?? playerName;

          return Container(
            key: ValueKey(playerName),
            decoration: BoxDecoration(
              color: Colors.white,
              border: index > 0
                  ? Border(top: BorderSide(color: Colors.grey[300]!))
                  : null,
            ),
            child: ListTile(
              leading: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  CircleAvatar(
                    backgroundColor: Colors.blue[100],
                    child: Text(
                      '${index + 1}',
                      style: TextStyle(
                        color: Colors.blue[900],
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Icon(Icons.drag_handle, color: Colors.grey[400]),
                ],
              ),
              title: Text(
                displayName,
                style: const TextStyle(
                  color: Colors.black87,
                  fontSize: 16,
                  fontWeight: FontWeight.w500,
                ),
              ),
              trailing: IconButton(
                icon: const Icon(Icons.close, color: Colors.red),
                onPressed: () => _removePlayer(index),
                tooltip: 'Remove player',
              ),
            ),
          );
        },
      ),
    );
  }
}
