import 'package:flutter/material.dart';
import 'package:fairway_sniper/screens/new_job_wizard.dart';
import 'package:fairway_sniper/screens/sniper_job_wizard.dart';
import 'package:fairway_sniper/services/firebase_service.dart';

class ModeSelectionScreen extends StatefulWidget {
  const ModeSelectionScreen({super.key});

  @override
  State<ModeSelectionScreen> createState() => _ModeSelectionScreenState();
}

class _ModeSelectionScreenState extends State<ModeSelectionScreen> {
  final _firebaseService = FirebaseService();
  Map<String, String>? _savedCreds;
  bool _loadingCreds = true;
  String? _displayName;

  @override
  void initState() {
    super.initState();
    _loadCreds();
  }

  Future<void> _loadCreds() async {
    final uid = _firebaseService.currentUserId;
    if (uid == null) {
      setState(() => _loadingCreds = false);
      return;
    }
    final creds = await _firebaseService.loadBRSCredentials(uid);
    final name = await _firebaseService.getUserDisplayName(uid);
    if (!mounted) return;
    setState(() {
      _savedCreds = creds;
      _loadingCreds = false;
      _displayName = name;
    });
  }

  void _startNormal() {
    Navigator.of(context)
        .push(MaterialPageRoute(builder: (_) => const NewJobWizard()));
  }

  void _startSniper() {
    Navigator.of(context)
        .push(MaterialPageRoute(builder: (_) => const SniperJobWizard()));
  }

  Future<void> _editSavedCreds() async {
    final uid = _firebaseService.currentUserId;
    if (uid == null || _savedCreds == null) return;

    final usernameController =
        TextEditingController(text: _savedCreds!['username'] ?? '');
    final passwordController =
        TextEditingController(text: _savedCreds!['password'] ?? '');

    final result = await showDialog<bool>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('Edit saved BRS login'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: usernameController,
                decoration: const InputDecoration(
                  labelText: 'BRS Username',
                  prefixIcon: Icon(Icons.person_outline),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: passwordController,
                obscureText: true,
                decoration: const InputDecoration(
                  labelText: 'BRS Password',
                  prefixIcon: Icon(Icons.lock_outline),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Save'),
            ),
          ],
        );
      },
    );

    if (result == true) {
      final u = usernameController.text.trim();
      final p = passwordController.text;
      if (u.isNotEmpty && p.isNotEmpty) {
        // Note: club is not available in this context, will be updated from wizard
        await _firebaseService.saveBRSCredentials(uid, u, p);
        if (!mounted) return;
        setState(() => _savedCreds = {'username': u, 'password': p});
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Saved BRS login updated.')),
        );
      }
    }
  }

  Future<void> _clearSavedCreds() async {
    final uid = _firebaseService.currentUserId;
    if (uid == null) return;
    await _firebaseService.clearBRSCredentials(uid);
    if (!mounted) return;
    setState(() => _savedCreds = null);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Saved BRS login cleared.')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final screenWidth = MediaQuery.of(context).size.width;
    final bool isNarrow = screenWidth < 860;
    final double bannerWidth = isNarrow
        ? (screenWidth - 48).clamp(240.0, 860.0)
        : 824.0; // width of two cards + spacing

    return Scaffold(
      appBar: AppBar(title: const Text('Choose Booking Mode')),
      body: Container(
        decoration: const BoxDecoration(
          image: DecorationImage(
            image: AssetImage(
                'assets/images/ultra-hd-golf-course-green-grass-o7ygl39odg1jxipx.jpg'),
            fit: BoxFit.cover,
          ),
        ),
        child: Container(
          color: Colors.black.withValues(alpha: 0.55),
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 1000),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    if (_loadingCreds) const LinearProgressIndicator(),
                    if (!_loadingCreds &&
                        (_savedCreds != null || _displayName != null))
                      SizedBox(
                        width: bannerWidth,
                        child: Container(
                          decoration: BoxDecoration(
                            color: Colors.green.shade50,
                            borderRadius: BorderRadius.circular(16),
                            border: Border.all(color: Colors.green.shade200),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withValues(alpha: 0.12),
                                blurRadius: 10,
                                offset: const Offset(0, 4),
                              ),
                            ],
                          ),
                          padding: const EdgeInsets.symmetric(
                              horizontal: 18, vertical: 14),
                          child: Row(
                            children: [
                              const Icon(Icons.info_outline,
                                  color: Color(0xFF2E7D32)),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    if (_displayName != null)
                                      Text(
                                        'Welcome back, ${_displayName!}',
                                        style: Theme.of(context)
                                            .textTheme
                                            .titleMedium
                                            ?.copyWith(
                                              fontWeight: FontWeight.w700,
                                              color: Colors.green.shade800,
                                            ),
                                      ),
                                    if (_savedCreds != null)
                                      Text(
                                        'Saved BRS login detected (username: ${_savedCreds!['username']}). You can reuse it in the wizard.',
                                        style: Theme.of(context)
                                            .textTheme
                                            .bodySmall
                                            ?.copyWith(
                                              color: Colors.green.shade700,
                                            ),
                                      ),
                                  ],
                                ),
                              ),
                              if (_savedCreds != null) ...[
                                IconButton(
                                  tooltip: 'Edit saved login',
                                  icon: const Icon(Icons.edit,
                                      color: Color(0xFF2E7D32)),
                                  onPressed: _editSavedCreds,
                                ),
                                IconButton(
                                  tooltip: 'Clear saved login',
                                  icon: const Icon(Icons.delete_outline,
                                      color: Colors.redAccent),
                                  onPressed: _clearSavedCreds,
                                ),
                              ],
                            ],
                          ),
                        ),
                      )
                    else if (!_loadingCreds)
                      SizedBox(
                        width: bannerWidth,
                        child: Container(
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(16),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withValues(alpha: 0.15),
                                blurRadius: 12,
                                offset: const Offset(0, 6),
                              ),
                            ],
                          ),
                          padding: const EdgeInsets.symmetric(
                              horizontal: 16, vertical: 12),
                          child: Row(
                            children: [
                              const Icon(Icons.info_outline,
                                  color: Colors.black87),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  'No saved BRS credentials yet. They will be stored after your first booking job.',
                                  style: Theme.of(context).textTheme.bodySmall,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    const SizedBox(height: 24),
                    if (isNarrow)
                      Column(
                        children: [
                          SizedBox(
                            width: double.infinity,
                            child: _modeCard(
                              title: 'Normal Mode',
                              icon: Icons.event_available,
                              color: Colors.lightGreen,
                              description:
                                  'Browse currently released tee sheets (next 5 days), view live slot availability, and book immediately.',
                              actionLabel: 'Start Normal Booking',
                              onTap: _startNormal,
                            ),
                          ),
                          const SizedBox(height: 24),
                          SizedBox(
                            width: double.infinity,
                            child: _modeCard(
                              title: 'Sniper Mode',
                              icon: Icons.my_location,
                              color: Colors.redAccent,
                              description:
                                  'Prepare a future booking beyond the current window and automatically snipe it at release time with rapid retries.',
                              actionLabel: 'Prepare Sniper Job',
                              onTap: _startSniper,
                            ),
                          ),
                        ],
                      )
                    else
                      Center(
                        child: SizedBox(
                          width: 824,
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              _modeCard(
                                title: 'Normal Mode',
                                icon: Icons.event_available,
                                color: Colors.lightGreen,
                                description:
                                    'Browse currently released tee sheets (next 5 days), view live slot availability, and book immediately.',
                                actionLabel: 'Start Normal Booking',
                                onTap: _startNormal,
                              ),
                              const SizedBox(width: 24),
                              _modeCard(
                                title: 'Sniper Mode',
                                icon: Icons.my_location,
                                color: Colors.redAccent,
                                description:
                                    'Prepare a future booking beyond the current window and automatically snipe it at release time with rapid retries.',
                                actionLabel: 'Prepare Sniper Job',
                                onTap: _startSniper,
                              ),
                            ],
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _modeCard({
    required String title,
    required IconData icon,
    required Color color,
    required String description,
    required String actionLabel,
    required VoidCallback onTap,
  }) {
    final theme = Theme.of(context);
    return SizedBox(
      width: 400,
      height: 260,
      child: Card(
        elevation: 8,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  CircleAvatar(
                    backgroundColor: color.withValues(alpha: 0.15),
                    radius: 28,
                    child: Icon(icon, color: color, size: 32),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Text(
                      title,
                      style: theme.textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Text(
                description,
                style: theme.textTheme.bodyMedium
                    ?.copyWith(color: Colors.grey.shade700),
                maxLines: 4,
                overflow: TextOverflow.ellipsis,
              ),
              const Spacer(),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: color,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                  ),
                  onPressed: onTap,
                  child: Text(actionLabel,
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
