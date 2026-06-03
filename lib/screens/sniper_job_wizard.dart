import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:fairway_sniper/models/booking_job.dart';
import 'package:fairway_sniper/services/firebase_service.dart';
import 'package:fairway_sniper/services/player_directory_service.dart';
import 'package:fairway_sniper/services/agent_base_url.dart';
import 'package:fairway_sniper/widgets/player_selector_modal.dart';
import 'package:fairway_sniper/widgets/player_list_editor.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'dart:async';
import 'package:fairway_sniper/theme/app_spacing.dart';
import 'package:fairway_sniper/theme/app_colors.dart';

class SniperJobWizard extends StatefulWidget {
  const SniperJobWizard({super.key});

  @override
  State<SniperJobWizard> createState() => _SniperJobWizardState();
}

class _SniperJobWizardState extends State<SniperJobWizard> {
  final _firebaseService = FirebaseService();
  late final PlayerDirectoryService _playerDirectoryService;
  final _pageController = PageController();
  int _currentPage = 0;

  // Credentials
  final _brsUsernameController = TextEditingController();
  final _brsPasswordController = TextEditingController();
  bool _obscureUser = true;
  bool _obscurePass = true;
  Map<String, String>? _savedCreds;
  bool _loadingCreds = false;
  bool _useSavedCreds = true;

  // Booking configuration
  String _club = 'galgorm';
  DateTime? _targetPlayDate; // actual desired play date (6+ days future)
  DateTime? _computedReleaseDateTime; // computed from target
  final List<String> _preferredTimes = [];
  int _additionalPlayerCount = 1; // additional players beyond Player 1
  List<String> _selectedPlayerIds = [];
  final Map<String, String> _playerLabelsById = {};
  String? _currentUserName; // Player 1 (logged-in user)
  final List<TextEditingController> _playerControllers = [
    TextEditingController()
  ];

  // Available times - will be fetched from agent when target date selected
  List<String> _availableTimes = [];
  String _teeMode = 'single';
  int _teeTarget = 1;
  bool _fallbackTee = false;
  String _agentBaseUrl = defaultAgentBaseUrl();
  bool _agentTesting = false;
  String? _agentTestStatus;
  bool _isRefreshingPlayers = false;
  bool _isNextBusy = false;
  bool _isBookingNow = false;
  String? _sniperTestJobId;
  String? _sniperTestStatus;
  Timer? _sniperTestPoller;
  bool _sniperTestRunning = false;

  int get _partySize => _additionalPlayerCount + 1;
  bool _agentHealthOk = true;
  String? _agentHealthBaseUrl;
  bool _skipCredsDone = false;

  final List<String> _fallbackTimes = [
    '08:10',
    '08:20',
    '08:30',
    '08:40',
    '08:50',
    '09:00',
    '09:10',
    '09:20',
    '09:30',
    '09:40',
    '09:50',
    '10:00',
    '10:10',
    '10:20',
    '10:30',
    '10:40',
    '10:50',
    '11:00',
    '11:10',
    '11:20',
    '11:30',
    '11:40',
    '11:50',
    '12:00',
    '12:10',
    '12:20',
    '12:30',
    '12:40',
    '12:50',
    '13:00',
    '13:10',
    '13:20',
    '13:30',
    '13:40',
    '13:50',
    '14:00',
    '14:10',
    '14:20',
    '14:30',
    '14:40',
    '14:50',
    '15:00',
    '15:10',
    '15:20',
    '15:30',
    '15:40',
    '15:50',
    '16:00',
    '16:10'
  ];

  List<String> _sniperGridTimes() {
    return List<String>.from(
      _availableTimes.isNotEmpty ? _availableTimes : _fallbackTimes,
    );
  }

  String _selectedTeeChoice() {
    if (_teeMode == 'both') return 'both';
    return _teeTarget == 10 ? '10' : '1';
  }

  void _setSelectedTeeChoice(String choice) {
    setState(() {
      if (choice == 'both') {
        _teeMode = 'both';
        _teeTarget = 1;
        _fallbackTee = true;
      } else if (choice == '10') {
        _teeMode = 'single';
        _teeTarget = 10;
        _fallbackTee = false;
      } else {
        _teeMode = 'single';
        _teeTarget = 1;
        _fallbackTee = false;
      }
    });
    if (_targetPlayDate != null) {
      _fetchAvailableTimesForDate(_targetPlayDate!);
    }
  }

  Map<String, dynamic> _teePayload() {
    return {
      'teeMode': _teeMode,
      'teeTarget': _teeTarget,
      'fallbackTee': _fallbackTee,
    };
  }

  void _maybeSkipCreds() {
    if (_skipCredsDone) return;
    if (_savedCreds != null && _useSavedCreds) {
      if (_pageController.hasClients) {
        _skipCredsDone = true;
        _pageController.jumpToPage(1);
        setState(() => _currentPage = 1);
      }
    }
  }

  @override
  void initState() {
    super.initState();
    _playerDirectoryService = PlayerDirectoryService(
      firebaseService: _firebaseService,
    );
    _loadCreds();
    _loadAgentBaseUrl();
    _runAgentDiagnostics();
    _availableTimes =
        _fallbackTimes; // Start with fallback until real times fetched
    if (kDebugMode) {
      _loadLastSniperTestJob();
    }
  }

  Future<void> _loadCreds() async {
    final uid = _firebaseService.currentUserId;
    if (uid == null) return;
    setState(() => _loadingCreds = true);
    final creds = await _firebaseService.loadBRSCredentials(uid);
    if (!mounted) return;
    setState(() {
      _savedCreds = creds;
      _loadingCreds = false;
      if (creds != null) {
        _brsUsernameController.text = creds['username'] ?? '';
        _brsPasswordController.text = creds['password'] ?? '';
      }
    });

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _maybeSkipCreds();
    });
  }

  Future<void> _loadAgentBaseUrl() async {
    final url = await getAgentBaseUrl();
    if (!mounted) return;
    setState(() => _agentBaseUrl = url);
  }

  Future<void> _runAgentDiagnostics() async {
    final baseUrl = await getAgentBaseUrl();
    if (!mounted) return;
    setState(() => _agentHealthBaseUrl = baseUrl);

    final healthUrl = '$baseUrl/api/health';
    print('🚨🚨 [AGENT-DIAG] HEALTH CHECK URL: $healthUrl');
    try {
      final response = await http
          .get(Uri.parse(healthUrl))
          .timeout(const Duration(seconds: 8));
      print(
          '🚨🚨 [AGENT-DIAG] HEALTH STATUS: ${response.statusCode} BODY: ${response.body}');
      if (!mounted) return;
      setState(() => _agentHealthOk = response.statusCode == 200);
    } catch (e) {
      print('🚨🚨 [AGENT-DIAG] HEALTH ERROR: $e');
      if (!mounted) return;
      setState(() => _agentHealthOk = false);
    }

    if (!_agentHealthOk) return;

    final diagUser = _brsUsernameController.text.trim();
    final diagPass = _brsPasswordController.text.trim();
    if (diagUser.isEmpty || diagPass.isEmpty) return;

    final fetchUrl = '$baseUrl/api/fetch-tee-times-range';
    final payload = {
      'startDate': DateTime.now().toIso8601String(),
      'days': 5,
      'username': diagUser,
      'password': diagPass,
      'club': _club,
      'reuseBrowser': true,
      ..._teePayload(),
    };
    print('🚨🚨 [AGENT-DIAG] FETCH URL: $fetchUrl');
    try {
      final response = await http
          .post(
            Uri.parse(fetchUrl),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode(payload),
          )
          .timeout(const Duration(minutes: 3));
      final body = response.body;
      final snippet = body.substring(0, body.length.clamp(0, 300));
      print(
          '🚨🚨 [AGENT-DIAG] FETCH STATUS: ${response.statusCode} BODY: $snippet');
    } catch (e) {
      print('🚨🚨 [AGENT-DIAG] FETCH ERROR: $e');
    }
  }

  @override
  void dispose() {
    _pageController.dispose();
    _brsUsernameController.dispose();
    _brsPasswordController.dispose();
    for (final c in _playerControllers) {
      c.dispose();
    }
    _sniperTestPoller?.cancel();
    super.dispose();
  }

  // Strategy mapping helper - hardcoded to maximum aggressiveness
  Map<String, dynamic> _buildStrategy() {
    // Maximum aggressiveness: fastest retry intervals and longest window
    // This ensures we're first when slots are released
    return {
      'start_interval_ms': 400, // Start with 400ms between retries
      'min_interval_ms': 250, // Minimum 250ms between retries
      'window_seconds': 360, // Keep trying for 6 minutes
      'aggressiveness': 1.0, // Maximum aggressiveness
      'profile': 'adaptive',
    };
  }

  bool _isValidSniperDate(DateTime date) {
    // Validity is based on the UK release instant, not the user's local date.
    // This matters when the operator is ahead of the UK, e.g. Taiwan.
    final releaseTimeUtc = _computeReleaseDateTime(date);
    return !releaseTimeUtc.isBefore(DateTime.now().toUtc());
  }

  bool _isReleasedDate(DateTime? date) {
    if (date == null) return false;
    return _computeReleaseDateTime(date).isBefore(DateTime.now().toUtc());
  }

  DateTime _computeReleaseDateTime(DateTime targetPlayDate) {
    final releaseDate = DateTime.utc(
      targetPlayDate.year,
      targetPlayDate.month,
      targetPlayDate.day,
    ).subtract(const Duration(days: 5));
    final utcHour = _isUkDstDate(releaseDate) ? 18 : 19;
    return DateTime.utc(
      releaseDate.year,
      releaseDate.month,
      releaseDate.day,
      utcHour,
      20,
    );
  }

  bool _isUkDstDate(DateTime utcDate) {
    final dateOnly = DateTime.utc(utcDate.year, utcDate.month, utcDate.day);
    final start = _lastSundayOfMonthUtc(utcDate.year, 3);
    final end = _lastSundayOfMonthUtc(utcDate.year, 10);
    return !dateOnly.isBefore(start) && dateOnly.isBefore(end);
  }

  DateTime _ukWallClock(DateTime utcDateTime) {
    final utc = utcDateTime.toUtc();
    return _isUkDstDate(utc) ? utc.add(const Duration(hours: 1)) : utc;
  }

  String _formatUkRelease(DateTime utcDateTime) {
    final suffix = _isUkDstDate(utcDateTime.toUtc()) ? 'BST' : 'GMT';
    return '${DateFormat("EEEE, MMM d 'at' h:mm a").format(_ukWallClock(utcDateTime))} UK ($suffix)';
  }

  DateTime _lastSundayOfMonthUtc(int year, int month) {
    final lastDay = DateTime.utc(year, month + 1, 0);
    return lastDay.subtract(Duration(days: lastDay.weekday % 7));
  }

  String _dateKey(DateTime date) {
    final normalized = DateTime.utc(date.year, date.month, date.day);
    return DateFormat('yyyy-MM-dd').format(normalized);
  }

  Future<void> _nextPage() async {
    if (_isNextBusy) return;
    if (_currentPage == 0) {
      if (_brsUsernameController.text.trim().isEmpty ||
          _brsPasswordController.text.isEmpty) {
        _showSnack('Enter BRS credentials');
        return;
      }
    }
    if (_currentPage == 1) {
      if (_targetPlayDate == null) {
        _showSnack('Select target play date');
        return;
      }
      setState(() => _isNextBusy = true);
      await _fetchAvailableTimesForDate(_targetPlayDate!);
      if (mounted) setState(() => _isNextBusy = false);

      // Note: For sniper mode, it's normal to have no times available yet
      // since we're booking future dates that haven't been released
    }
    if (_currentPage == 2) {
      if (_preferredTimes.isEmpty) {
        _showSnack('Select at least one preferred time');
        return;
      }
    }
    if (_currentPage == 3) {
      if (_partySize < 1 || _partySize > 4) {
        _showSnack('Select additional players (0 to 3)');
        return;
      }
      setState(() => _isNextBusy = true);
      await _preloadPlayerDirectory();
      if (mounted) setState(() => _isNextBusy = false);
    }
    if (_currentPage == 4) {
      if (_selectedPlayerIds.length != _additionalPlayerCount) {
        _showSnack(
            'Select exactly $_additionalPlayerCount additional player${_additionalPlayerCount == 1 ? '' : 's'}');
        return;
      }
      if (_selectedPlayerIds.toSet().length != _selectedPlayerIds.length) {
        _showSnack('Remove duplicate players');
        return;
      }
    }
    if (_currentPage < 4) {
      _pageController.nextPage(
          duration: const Duration(milliseconds: 300), curve: Curves.easeInOut);
    }
  }

  void _prevPage() {
    if (_currentPage > 0) {
      _pageController.previousPage(
          duration: const Duration(milliseconds: 300), curve: Curves.easeInOut);
    }
  }

  void _showSnack(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  Future<void> _saveJob() async {
    final uid = _firebaseService.currentUserId;
    if (uid == null) {
      _showSnack('Not logged in');
      return;
    }

    // Validation
    if (_brsUsernameController.text.trim().isEmpty ||
        _brsPasswordController.text.isEmpty) {
      _showSnack('BRS credentials required');
      return;
    }
    if (_targetPlayDate == null) {
      _showSnack('Target play date required');
      return;
    }
    if (_preferredTimes.isEmpty) {
      _showSnack('At least one preferred time required');
      return;
    }
    if (_selectedPlayerIds.length != _additionalPlayerCount) {
      _showSnack(
          'Select exactly $_additionalPlayerCount additional player${_additionalPlayerCount == 1 ? '' : 's'}');
      return;
    }
    if (_selectedPlayerIds.toSet().length != _selectedPlayerIds.length) {
      _showSnack('Remove duplicate players');
      return;
    }
    if (!_isValidSniperDate(_targetPlayDate!)) {
      _showSnack('Release has passed. Use Book Now instead.');
      return;
    }

    setState(() => _isNextBusy = true);

    try {
      final players = _selectedPlayerIds;
      final strategy = _buildStrategy();
      final releaseDateTime = _computeReleaseDateTime(_targetPlayDate!);
      final targetDateKey = _dateKey(_targetPlayDate!);

      final job = BookingJob(
        ownerUid: uid,
        brsEmail: _brsUsernameController.text.trim(),
        brsPassword: _brsPasswordController.text,
        club: _club,
        timezone: 'Europe/London',
        releaseDay: DateFormat('EEEE').format(releaseDateTime),
        releaseTimeLocal: '19:20',
        targetDay: DateFormat('EEEE').format(_targetPlayDate!),
        preferredTimes: _preferredTimes,
        players: players,
        partySize: _partySize,
        bookingMode: BookingMode.sniper,
        targetDate: targetDateKey,
        targetPlayDate: DateTime.utc(
          _targetPlayDate!.year,
          _targetPlayDate!.month,
          _targetPlayDate!.day,
        ),
        releaseWindowStart: releaseDateTime,
        snipeStrategy: strategy,
        teeMode: _teeMode,
        teeTarget: _teeTarget,
        fallbackTee: _fallbackTee,
        status: 'active', // Explicitly set to active
      );

      print('🔵 [WIZARD] Job status before save: ${job.status}');

      await _firebaseService.saveBRSCredentials(
          uid, _brsUsernameController.text.trim(), _brsPasswordController.text,
          club: _club);

      final id = await _firebaseService.createJob(job);

      if (!mounted) return;

      // Clear draft after successful save
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove('sniper_wizard_draft');

      Navigator.of(context).pop();
      _showSnack('✓ Sniper job created! ID: $id');
    } catch (e) {
      if (!mounted) return;
      _showSnack(
          'Error: ${e.toString().length > 80 ? e.toString().substring(0, 80) + '...' : e}');
    } finally {
      if (mounted) {
        setState(() => _isNextBusy = false);
      }
    }
  }

  Future<void> _bookNow() async {
    final uid = _firebaseService.currentUserId;
    if (uid == null) {
      _showSnack('Not logged in');
      return;
    }
    if (_brsUsernameController.text.trim().isEmpty ||
        _brsPasswordController.text.isEmpty) {
      _showSnack('BRS credentials required');
      return;
    }
    if (_targetPlayDate == null) {
      _showSnack('Target play date required');
      return;
    }
    if (_preferredTimes.isEmpty) {
      _showSnack('At least one preferred time required');
      return;
    }
    if (_selectedPlayerIds.length != _additionalPlayerCount) {
      _showSnack(
          'Select exactly $_additionalPlayerCount additional player${_additionalPlayerCount == 1 ? '' : 's'}');
      return;
    }
    if (_selectedPlayerIds.toSet().length != _selectedPlayerIds.length) {
      _showSnack('Remove duplicate players');
      return;
    }

    setState(() => _isBookingNow = true);
    _showBookingProgressDialog();

    try {
      await _firebaseService.saveBRSCredentials(
          uid, _brsUsernameController.text.trim(), _brsPasswordController.text,
          club: _club);

      final baseUrl = await getAgentBaseUrl();
      final response = await http
          .post(
            Uri.parse('$baseUrl/api/book-now'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'username': _brsUsernameController.text.trim(),
              'password': _brsPasswordController.text,
              'targetDate': _dateKey(_targetPlayDate!),
              'preferredTimes': _preferredTimes,
              'players': _selectedPlayerIds,
              'partySize': _partySize,
              ..._teePayload(),
              'dryRun': !kDebugMode,
              'adminDevTool': kDebugMode,
            }),
          )
          .timeout(const Duration(seconds: 180));

      if (mounted && Navigator.of(context).canPop()) {
        Navigator.of(context).pop();
      }

      final data = response.body.isNotEmpty
          ? jsonDecode(response.body) as Map<String, dynamic>
          : <String, dynamic>{};
      final success = response.statusCode == 200 && data['success'] == true;
      if (!mounted) return;

      if (success) {
        Navigator.of(context).pop();
        _showSnack('Booked ${data['bookedTime'] ?? data['booked_time'] ?? ''}');
      } else {
        final error = data['error'] ?? data['notes'] ?? 'booking failed';
        _showSnack('Booking failed: $error');
      }
    } catch (e) {
      if (!mounted) return;
      if (Navigator.of(context).canPop()) {
        Navigator.of(context).pop();
      }
      _showSnack('Booking failed: $e');
    } finally {
      if (mounted) setState(() => _isBookingNow = false);
    }
  }

  void _showBookingProgressDialog() {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => const AlertDialog(
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(),
            SizedBox(height: 16),
            Text('Attempting booking now...\nPlease wait'),
          ],
        ),
      ),
    );
  }

  Future<void> _fetchAvailableTimesForDate(DateTime date) async {
    if (_brsUsernameController.text.trim().isEmpty ||
        _brsPasswordController.text.isEmpty) {
      setState(() {
        _availableTimes = _fallbackTimes;
      });
      return;
    }

    String agentUrl = _agentBaseUrl;
    try {
      agentUrl = await getAgentBaseUrl();
      final dateStr = DateFormat('yyyy-MM-dd').format(date);

      // Sniper mode should always live-check the selected date
      // to avoid showing stale or wrong-day availability.

      final response = await http
          .post(
            Uri.parse('$agentUrl/api/fetch-tee-times'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'date': dateStr,
              'username': _brsUsernameController.text.trim(),
              'password': _brsPasswordController.text,
              'includeUnavailable': true,
              ..._teePayload(),
            }),
          )
          .timeout(const Duration(minutes: 3));

      if (!mounted) return;

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        final List<dynamic> times = _extractTimes(data);

        List<String> normalizeTimes(List<dynamic> raw) {
          final cleaned = raw
              .map((t) => t.toString().trim())
              .where((t) => RegExp(r'^\d{1,2}:\d{2}$').hasMatch(t))
              .map((t) => t.padLeft(5, '0'))
              .toSet()
              .toList();
          cleaned.sort();

          if (cleaned.isEmpty) return _fallbackTimes;
          return cleaned;
        }

        final normalizedTimes = normalizeTimes(times);
        setState(() {
          _availableTimes = normalizedTimes;
          _preferredTimes.removeWhere((t) => !normalizedTimes.contains(t));
        });
      } else {
        throw Exception('Agent returned ${response.statusCode} at $agentUrl');
      }
    } catch (e) {
      if (!mounted) return;
      _showSnack(
        'Failed to fetch tee times at $agentUrl. ${_agentHelpText()} ($e)',
      );
      setState(() {
        _availableTimes = _fallbackTimes;
      });
    }
  }

  List<dynamic> _extractTimes(dynamic decoded) {
    if (decoded is! Map) return const [];
    final merged = <dynamic>[];

    void addTimes(dynamic raw) {
      if (raw is List) {
        merged.addAll(raw);
      }
    }

    addTimes(decoded['times']);

    final tee1 = decoded['tee1'];
    if (tee1 is Map) addTimes(tee1['times']);

    final tee10 = decoded['tee10'];
    if (tee10 is Map) addTimes(tee10['times']);

    return merged;
  }

  @override
  Widget build(BuildContext context) {
    _maybeSkipCreds();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Sniper Booking Wizard'),
        elevation: 0,
        actions: [
          if (kDebugMode)
            TextButton(
              onPressed: _sniperTestRunning ? null : _runSniperTest,
              child: Text(
                _sniperTestRunning ? 'Testing...' : 'Sniper Test (4m)',
                style: const TextStyle(color: Colors.white),
              ),
            ),
          TextButton(
            onPressed: _currentPage == 4 ? _saveJob : null,
            child: const Text('Save',
                style: TextStyle(
                    color: Colors.white, fontWeight: FontWeight.bold)),
          )
        ],
      ),
      body: Container(
        color: const Color(0xFF1a1a1a),
        child: Column(
          children: [
            // Agent health status (non-blocking badge)
            if (!_agentHealthOk && _agentHealthBaseUrl != null)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.lg,
                  vertical: AppSpacing.sm,
                ),
                color: Colors.orange.shade50,
                child: Row(
                  children: [
                    Icon(Icons.warning_rounded,
                        color: Colors.orange.shade700, size: 20),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: Text(
                        'Agent not responding at $_agentHealthBaseUrl',
                        style: TextStyle(
                          color: Colors.orange.shade900,
                          fontSize: 13,
                        ),
                      ),
                    ),
                    TextButton(
                      onPressed: _testAgentConnection,
                      child:
                          const Text('Retry', style: TextStyle(fontSize: 12)),
                    ),
                  ],
                ),
              ),
            _buildStepper(),
            Expanded(
              child: PageView(
                controller: _pageController,
                physics: const NeverScrollableScrollPhysics(),
                onPageChanged: (p) => setState(() => _currentPage = p),
                children: [
                  _buildCredentialsPage(),
                  _buildDatePage(),
                  _buildPreferredTimesPage(),
                  _buildPartySizePage(),
                  _buildPlayersPage(),
                ],
              ),
            ),
            if (_currentPage == 4)
              Padding(
                padding: const EdgeInsets.all(AppSpacing.lg),
                child: Card(
                  color: Colors.white.withValues(alpha: 0.08),
                  elevation: 0,
                  child: Padding(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(Icons.checklist,
                                color: Colors.white70, size: 20),
                            const SizedBox(width: AppSpacing.md),
                            Text(
                              'Review Your Booking',
                              style: Theme.of(context)
                                  .textTheme
                                  .titleSmall
                                  ?.copyWith(
                                      fontWeight: FontWeight.w600,
                                      color: Colors.white),
                            ),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.lg),
                        Text(
                          '• Play Date: ${_targetPlayDate != null ? DateFormat('EEE, MMM d').format(_targetPlayDate!) : 'Not selected'}\n'
                          '• Release: ${_computedReleaseDateTime != null ? DateFormat('h:mm a').format(_computedReleaseDateTime!) : 'Not calculated'}\n'
                          '• Tee: ${_teeTarget == 10 ? '10th Tee' : '1st Tee'}\n'
                          '• Preferred Times: ${_preferredTimes.isNotEmpty ? _preferredTimes.join(', ') : 'Not selected'}\n'
                          '• Total Players: $_partySize',
                          style: Theme.of(context)
                              .textTheme
                              .bodySmall
                              ?.copyWith(color: Colors.white70),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            _buildNavBar(),
          ],
        ),
      ),
    );
  }

  Widget _buildStepper() {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.xl,
        vertical: AppSpacing.md,
      ),
      child: Row(
        children: List.generate(5, (i) {
          final active = i == _currentPage;
          final done = i < _currentPage;
          return Expanded(
            child: Container(
              height: 4,
              margin: EdgeInsets.only(right: i < 4 ? 8 : 0),
              decoration: BoxDecoration(
                color: done || active
                    ? Theme.of(context).colorScheme.primary
                    : Colors.grey.shade300,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          );
        }),
      ),
    );
  }

  Widget _buildNavBar() {
    final isLastPage = _currentPage == 4;
    final canContinue = _currentPage < 4 && !_isNextBusy;
    final isReleased = _isReleasedDate(_targetPlayDate);
    final useDebugBookNow = isReleased && kDebugMode;
    final canSave = isLastPage && !_isNextBusy && !_isBookingNow;

    return Container(
      decoration: BoxDecoration(
        border: Border(
            top: BorderSide(color: Colors.white.withValues(alpha: 0.15))),
        color: Colors.transparent,
      ),
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              OutlinedButton.icon(
                onPressed: () => Navigator.of(context)
                    .pushNamedAndRemoveUntil('/', (route) => false),
                icon: const Icon(Icons.home),
                label: const Text('Home'),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed:
                      _currentPage == 0 || _isNextBusy ? null : _prevPage,
                  icon: const Icon(Icons.arrow_back),
                  label: const Text('Back'),
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: canContinue
                      ? _nextPage
                      : (canSave ? (useDebugBookNow ? _bookNow : _saveJob) : null),
                  icon: _isNextBusy || _isBookingNow
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Icon(isLastPage
                          ? (useDebugBookNow ? Icons.flash_on : Icons.check)
                          : Icons.arrow_forward),
                  label: Text(
                    _isNextBusy || _isBookingNow
                        ? 'Loading...'
                        : isLastPage
                            ? (useDebugBookNow ? 'Book Now' : 'Create Job')
                            : 'Continue',
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _loadLastSniperTestJob() async {
    final prefs = await SharedPreferences.getInstance();
    final jobId = prefs.getString('last_sniper_test_job_id');
    if (jobId == null || jobId.isEmpty) return;
    setState(() => _sniperTestJobId = jobId);
  }

  Future<void> _runSniperTest() async {
    if (_sniperTestRunning) return;
    final username = _brsUsernameController.text.trim();
    final password = _brsPasswordController.text;
    if (username.isEmpty || password.isEmpty) {
      _showSnack('Enter BRS credentials first');
      return;
    }
    final targetDate = _targetPlayDate ?? DateTime.now();
    if (_preferredTimes.isEmpty && _availableTimes.isEmpty) {
      _showSnack('Select a preferred time first');
      return;
    }
    final time = _preferredTimes.isNotEmpty
        ? _preferredTimes.first
        : _availableTimes.first;

    setState(() {
      _sniperTestRunning = true;
      _sniperTestStatus = 'Scheduling 4-min test...';
    });

    try {
      final baseUrl = await getAgentBaseUrl();
      final response = await http.post(
        Uri.parse('$baseUrl/api/sniper-test'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'username': username,
          'password': password,
          'targetDate': DateFormat('yyyy-MM-dd').format(targetDate),
          'preferredTimes': [time],
          'players': _selectedPlayerIds,
          'partySize': _partySize,
          'minutes': 4,
          ..._teePayload(),
          'dryRun': true,
        }),
      );
      if (response.statusCode != 200) {
        throw Exception('Agent error ${response.statusCode}');
      }
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      if (data['success'] != true) {
        throw Exception(data['error'] ?? 'Sniper test failed');
      }
      final jobId = data['jobId']?.toString();
      if (jobId == null || jobId.isEmpty) {
        throw Exception('Missing jobId');
      }
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('last_sniper_test_job_id', jobId);
      setState(() {
        _sniperTestJobId = jobId;
        _sniperTestStatus = 'Scheduled. Waiting...';
      });
      _startSniperTestPolling(jobId);
    } catch (e) {
      _showSnack('Sniper test failed: $e');
      setState(() => _sniperTestStatus = 'Failed: $e');
    } finally {
      if (mounted) {
        setState(() => _sniperTestRunning = false);
      }
    }
  }

  void _startSniperTestPolling(String jobId) {
    _sniperTestPoller?.cancel();
    _sniperTestPoller = Timer.periodic(const Duration(seconds: 2), (_) async {
      try {
        final baseUrl = await getAgentBaseUrl();
        final resp = await http.get(Uri.parse('$baseUrl/api/jobs/$jobId'));
        if (resp.statusCode != 200) return;
        final data = jsonDecode(resp.body) as Map<String, dynamic>;
        if (data['success'] != true) return;
        final status = data['status']?.toString() ?? 'unknown';
        if (!mounted) return;
        setState(() {
          _sniperTestStatus = 'Status: $status';
        });
        if (status == 'success' || status == 'failed') {
          _sniperTestPoller?.cancel();
        }
      } catch (_) {}
    });
  }

  Widget _buildCredentialsPage() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(AppSpacing.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.lock_outline, size: 48, color: Colors.blue),
          const SizedBox(height: AppSpacing.lg),
          Text('BRS Login Credentials',
              style: Theme.of(context)
                  .textTheme
                  .headlineSmall
                  ?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: AppSpacing.sm),
          Text('Required to log in automatically at release time.',
              style: Theme.of(context).textTheme.bodyMedium),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'Your credentials are encrypted in Firebase and only used at booking time.',
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: Colors.green.shade700),
          ),
          const SizedBox(height: AppSpacing.xl),
          if (_loadingCreds)
            const LinearProgressIndicator()
          else if (_savedCreds != null)
            _savedCredBanner()
          else
            _noCredsBanner(),
          const SizedBox(height: AppSpacing.xl),
          TextField(
            controller: _brsUsernameController,
            obscureText: _obscureUser,
            enabled: !_useSavedCreds || _savedCreds == null,
            decoration: InputDecoration(
              labelText: 'BRS Username',
              prefixIcon: const Icon(Icons.person),
              suffixIcon: IconButton(
                icon: Icon(
                    _obscureUser ? Icons.visibility : Icons.visibility_off),
                onPressed: () => setState(() => _obscureUser = !_obscureUser),
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          TextField(
            controller: _brsPasswordController,
            obscureText: _obscurePass,
            enabled: !_useSavedCreds || _savedCreds == null,
            decoration: InputDecoration(
              labelText: 'BRS Password',
              prefixIcon: const Icon(Icons.lock),
              suffixIcon: IconButton(
                icon: Icon(
                    _obscurePass ? Icons.visibility : Icons.visibility_off),
                onPressed: () => setState(() => _obscurePass = !_obscurePass),
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.xl),
          _buildAgentConnectionRow(),
          if (kDebugMode && _sniperTestJobId != null) ...[
            const SizedBox(height: AppSpacing.lg),
            Card(
              color: Colors.blueGrey.shade50,
              child: Padding(
                padding: const EdgeInsets.all(AppSpacing.md),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Sniper Test Status',
                      style: TextStyle(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    Text(
                      'Job: $_sniperTestJobId',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    if (_sniperTestStatus != null) ...[
                      const SizedBox(height: AppSpacing.xs),
                      Text(
                        _sniperTestStatus!,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: Colors.blueGrey.shade700,
                            ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _savedCredBanner() {
    return Card(
      color: Colors.green.shade50,
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.md),
        child: Row(
          children: [
            const Icon(Icons.check_circle, color: Colors.green),
            const SizedBox(width: AppSpacing.md),
            Expanded(
                child: Text(
                    'Saved credentials available. Use them or toggle off to enter new.',
                    style: Theme.of(context)
                        .textTheme
                        .bodySmall
                        ?.copyWith(color: Colors.green.shade700))),
            Switch(
                value: _useSavedCreds,
                onChanged: (v) {
                  setState(() => _useSavedCreds = v);
                  if (v) {
                    _brsUsernameController.text =
                        _savedCreds!['username'] ?? '';
                    _brsPasswordController.text =
                        _savedCreds!['password'] ?? '';
                  } else {
                    _brsUsernameController.clear();
                    _brsPasswordController.clear();
                  }
                })
          ],
        ),
      ),
    );
  }

  Widget _noCredsBanner() {
    return Card(
      color: Colors.yellow.shade50,
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.md),
        child: Row(children: [
          const Icon(Icons.info_outline, color: Colors.orange),
          const SizedBox(width: AppSpacing.md),
          Expanded(
              child: Text(
                  'No saved credentials yet; they will be stored after creating a job.',
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: Colors.orange.shade800))),
        ]),
      ),
    );
  }

  Widget _buildDatePage() {
    final releaseUtc = _computedReleaseDateTime;
    final minutesUntilRelease = releaseUtc == null
        ? 0
        : releaseUtc.difference(DateTime.now().toUtc()).inMinutes;
    final daysUntilRelease = minutesUntilRelease ~/ (24 * 60);
    final isReleased = _isReleasedDate(_targetPlayDate);

    return SingleChildScrollView(
      padding: const EdgeInsets.all(AppSpacing.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.event, size: 48, color: Colors.blue),
          const SizedBox(height: AppSpacing.lg),
          Text('Target Play Date',
              style: Theme.of(context)
                  .textTheme
                  .headlineSmall
                  ?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: AppSpacing.sm),
          Text(
              'Pick your desired golf date. Bookings release 5 days before at 7:20 PM UK time.',
              style: Theme.of(context).textTheme.bodyMedium),
          const SizedBox(height: AppSpacing.xl),
          InkWell(
            onTap: () async {
              final now = DateTime.now();
              final minDate = DateTime(now.year, now.month, now.day);
              final initialDate =
                  _targetPlayDate != null && !_targetPlayDate!.isBefore(minDate)
                      ? _targetPlayDate!
                      : minDate;
              final picked = await showDatePicker(
                context: context,
                firstDate: minDate,
                lastDate: now.add(const Duration(days: 90)),
                initialDate: initialDate,
              );
              if (picked != null) {
                setState(() {
                  _targetPlayDate = picked;
                  _computedReleaseDateTime = _computeReleaseDateTime(picked);
                });
              }
            },
            child: Card(
              elevation: 2,
              child: Padding(
                padding: const EdgeInsets.all(AppSpacing.lg),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _targetPlayDate == null
                              ? 'Tap to choose date'
                              : DateFormat('EEEE, MMMM d, yyyy')
                                  .format(_targetPlayDate!),
                          style: const TextStyle(
                              fontSize: 16, fontWeight: FontWeight.w600),
                        ),
                        if (_targetPlayDate != null)
                          Text(
                            '${_targetPlayDate!.difference(DateTime.now()).inDays} days from now',
                            style: Theme.of(context)
                                .textTheme
                                .bodySmall
                                ?.copyWith(color: Colors.grey.shade600),
                          ),
                      ],
                    ),
                    const Icon(Icons.calendar_today, color: Colors.blue)
                  ],
                ),
              ),
            ),
          ),
          if (_targetPlayDate != null) ...[
            const SizedBox(height: AppSpacing.xl),
            Card(
              color: Colors.blue.shade50,
              elevation: 0,
              child: Padding(
                padding: const EdgeInsets.all(AppSpacing.lg),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(Icons.alarm,
                            color: Colors.blue.shade700, size: 22),
                        const SizedBox(width: 8),
                        Text('Release Window',
                            style: Theme.of(context)
                                .textTheme
                                .titleMedium
                                ?.copyWith(
                                    fontWeight: FontWeight.bold,
                                    color: Colors.blue.shade900)),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.md),
                    Text(
                      _formatUkRelease(_computedReleaseDateTime!),
                      style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                          fontWeight: FontWeight.w600,
                          color: Colors.blue.shade900),
                    ),
                    const SizedBox(height: 8),
                    if (minutesUntilRelease > 0)
                      Text(
                        daysUntilRelease > 0
                            ? 'Booking opens in $daysUntilRelease days'
                            : 'Booking opens in $minutesUntilRelease minutes',
                        style: Theme.of(context)
                            .textTheme
                            .bodySmall
                            ?.copyWith(color: Colors.blue.shade700),
                      )
                    else
                      Text(
                        'Already released. Continue to choose times and press Book Now.',
                        style: Theme.of(context)
                            .textTheme
                            .bodySmall
                            ?.copyWith(color: Colors.green.shade700),
                      ),
                    const SizedBox(height: AppSpacing.md),
                    Text(
                      isReleased
                          ? 'This will run an immediate live booking attempt. It will try your preferred times in order.'
                          : 'The sniper will automatically log in and attempt to book your preferred times at exactly this moment.',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          fontStyle: FontStyle.italic,
                          color: Colors.blue.shade800),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildPreferredTimesPage() {
    final displayTimes = _sniperGridTimes();
    return SingleChildScrollView(
      padding: const EdgeInsets.all(AppSpacing.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.schedule, size: 48, color: Colors.blue),
          const SizedBox(height: AppSpacing.lg),
          Text('Preferred Tee Times',
              style: Theme.of(context)
                  .textTheme
                  .headlineSmall
                  ?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: AppSpacing.sm),
          Text('Pick up to 3 target times in order of preference.',
              style: Theme.of(context).textTheme.bodyMedium),
          const SizedBox(height: AppSpacing.md),
          Text('Tee Sheet',
              style: Theme.of(context)
                  .textTheme
                  .titleSmall
                  ?.copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: AppSpacing.sm),
          Wrap(
            spacing: AppSpacing.sm,
            children: [
              ChoiceChip(
                label: const Text('1st Tee'),
                selected: _selectedTeeChoice() == '1',
                onSelected: (_) => _setSelectedTeeChoice('1'),
              ),
              ChoiceChip(
                label: const Text('10th Tee'),
                selected: _selectedTeeChoice() == '10',
                onSelected: (_) => _setSelectedTeeChoice('10'),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.xl),
          // Explanation card
          Card(
            color: Colors.amber.shade50,
            elevation: 0,
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.info_outline,
                          color: Colors.amber.shade700, size: 18),
                      const SizedBox(width: AppSpacing.sm),
                      Expanded(
                        child: Text(
                          'Smart Fallback Window',
                          style: TextStyle(
                            fontWeight: FontWeight.w600,
                            color: Colors.amber.shade900,
                            fontSize: 13,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Text(
                    'If your first choice is full, the sniper automatically tries nearby times (within ±10 minutes) to maximize your booking chances.',
                    style: Theme.of(context)
                        .textTheme
                        .bodySmall
                        ?.copyWith(color: Colors.amber.shade900),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.xl),
          if (_preferredTimes.isNotEmpty) ...[
            Text('Your Selection',
                style: Theme.of(context)
                    .textTheme
                    .titleMedium
                    ?.copyWith(fontWeight: FontWeight.w600)),
            const SizedBox(height: AppSpacing.sm),
            ...List.generate(
                _preferredTimes.length,
                (i) => Padding(
                      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                      child: Card(
                        color: Colors.blue.shade50,
                        child: ListTile(
                          leading: CircleAvatar(
                            backgroundColor: Colors.blue,
                            child: Text('${i + 1}',
                                style: const TextStyle(color: Colors.white)),
                          ),
                          title: Text(_preferredTimes[i],
                              style: const TextStyle(
                                  fontWeight: FontWeight.w600,
                                  fontSize: 16,
                                  color: Colors.black87)),
                          trailing: IconButton(
                              icon: const Icon(Icons.delete_outline,
                                  color: Colors.black54),
                              onPressed: () =>
                                  setState(() => _preferredTimes.removeAt(i))),
                        ),
                      ),
                    )),
            const SizedBox(height: AppSpacing.lg),
          ],
          Text('Visible Target Times',
              style: Theme.of(context)
                  .textTheme
                  .titleMedium
                  ?.copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'Pre-release rows are valid targets even if booking links are not live yet.',
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: Colors.grey.shade600),
          ),
          const SizedBox(height: AppSpacing.md),
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: displayTimes
                .where((t) => !_preferredTimes.contains(t))
                .map((t) => ActionChip(
                      label: Text(t,
                          style: const TextStyle(
                              color: Colors.black87,
                              fontWeight: FontWeight.w600)),
                      backgroundColor: Colors.white,
                      onPressed: () {
                        if (_preferredTimes.length < 3) {
                          setState(() => _preferredTimes.add(t));
                        } else {
                          _showSnack('Maximum 3 times selected');
                        }
                      },
                    ))
                .toList(),
          ),
        ],
      ),
    );
  }

  Widget _buildPartySizePage() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(AppSpacing.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.group, size: 48, color: Colors.blue),
          const SizedBox(height: AppSpacing.lg),
          Text('How Many Players?',
              style: Theme.of(context)
                  .textTheme
                  .headlineSmall
                  ?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: AppSpacing.sm),
          Text('Select how many additional players beyond you.',
              style: Theme.of(context).textTheme.bodyMedium),
          const SizedBox(height: AppSpacing.xl),
          Wrap(
            spacing: AppSpacing.md,
            children: [0, 1, 2, 3]
                .map((count) => ChoiceChip(
                      label: Text(
                        count == 0
                            ? 'Just me'
                            : '+ $count player${count > 1 ? 's' : ''}',
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                      selected: _additionalPlayerCount == count,
                      selectedColor: Colors.blue,
                      labelStyle: TextStyle(
                        color: _additionalPlayerCount == count
                            ? Colors.white
                            : Colors.grey.shade700,
                      ),
                      onSelected: (_) {
                        setState(() {
                          _additionalPlayerCount = count;
                          final maxAdditional = _additionalPlayerCount;
                          if (_selectedPlayerIds.length > maxAdditional) {
                            _selectedPlayerIds =
                                _selectedPlayerIds.sublist(0, maxAdditional);
                          }
                        });
                      },
                    ))
                .toList(),
          ),
          const SizedBox(height: AppSpacing.xl),
          Card(
            color: Colors.blue.shade50,
            elevation: 0,
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.md),
              child: Text(
                _additionalPlayerCount == 0
                    ? '🎯 Booking for yourself only'
                    : '🎯 You + $_additionalPlayerCount more = total $_partySize players',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: Colors.blue.shade900, fontWeight: FontWeight.w600),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPlayersPage() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(AppSpacing.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.people_outline, size: 48, color: Colors.blue),
          const SizedBox(height: AppSpacing.lg),
          Text('Select Players',
              style: Theme.of(context)
                  .textTheme
                  .headlineSmall
                  ?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: AppSpacing.sm),
          Text(
              'Malcolm is Player 1. Choose exactly $_additionalPlayerCount additional player${_additionalPlayerCount != 1 ? 's' : ''} from the club directory.',
              style: Theme.of(context).textTheme.bodyMedium),
          const SizedBox(height: AppSpacing.xl),
          if (_currentUserName != null && _currentUserName!.isNotEmpty)
            Card(
              color: AppColors.success.withValues(alpha: 0.15),
              elevation: 0,
              child: Padding(
                padding: const EdgeInsets.all(AppSpacing.lg),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(AppSpacing.md),
                          decoration: BoxDecoration(
                            color: AppColors.success.withValues(alpha: 0.2),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(Icons.check_circle,
                              color: AppColors.success, size: 24),
                        ),
                        const SizedBox(width: AppSpacing.lg),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'You (Player 1)',
                                style: Theme.of(context)
                                    .textTheme
                                    .bodySmall
                                    ?.copyWith(color: AppColors.success),
                              ),
                              Text(
                                _currentUserName ?? 'Unknown',
                                style: Theme.of(context)
                                    .textTheme
                                    .titleMedium
                                    ?.copyWith(
                                        fontWeight: FontWeight.w700,
                                        color: Colors.white),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            )
          else
            Card(
              color: Colors.white.withValues(alpha: 0.08),
              elevation: 0,
              child: Padding(
                padding: const EdgeInsets.all(AppSpacing.lg),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(AppSpacing.md),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.1),
                        shape: BoxShape.circle,
                      ),
                      child:
                          Icon(Icons.person, color: Colors.white54, size: 24),
                    ),
                    const SizedBox(width: AppSpacing.lg),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Player 1',
                          style: Theme.of(context)
                              .textTheme
                              .bodySmall
                              ?.copyWith(color: Colors.white54),
                        ),
                        Text(
                          'You (logged in user)',
                          style: Theme.of(context)
                              .textTheme
                              .titleMedium
                              ?.copyWith(
                                  fontWeight: FontWeight.w600,
                                  color: Colors.white70),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          if (_additionalPlayerCount > 0) ...[
            const SizedBox(height: AppSpacing.xxl),
            Text(
              'Additional Players (${_selectedPlayerIds.length}/$_additionalPlayerCount)',
              style: Theme.of(context)
                  .textTheme
                  .titleMedium
                  ?.copyWith(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: AppSpacing.lg),
            PlayerListEditor(
              playerNames: _selectedPlayerIds,
              playerLabels: _playerLabelsById,
              onPlayersChanged: (updated) {
                setState(() => _selectedPlayerIds = updated);
              },
              onAddPlayers: _showPlayerSelector,
              maxPlayers: _additionalPlayerCount,
            ),
            if (_isRefreshingPlayers) ...[
              const SizedBox(height: 8),
              Text(
                'Updating player directory...',
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: Colors.grey.shade600),
              ),
            ],
          ] else
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.xxl),
              child: Card(
                color: AppColors.success.withValues(alpha: 0.15),
                elevation: 0,
                child: Padding(
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  child: Row(
                    children: [
                      Icon(Icons.check_circle_outline,
                          color: AppColors.success, size: 24),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: Text(
                          'Perfect! Just you for this booking',
                          style: Theme.of(context)
                              .textTheme
                              .bodyMedium
                              ?.copyWith(
                                  fontWeight: FontWeight.w600,
                                  color: AppColors.success),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  String _agentHelpText() {
    return 'If you are on Android emulator, use http://10.0.2.2:3000. '
        'If you are on a physical phone, use your PC LAN IP (e.g. http://192.168.x.x:3000).';
  }

  Future<void> _showAgentUrlDialog() async {
    final controller = TextEditingController(text: _agentBaseUrl);
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Agent Base URL'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(
            hintText: 'http://localhost:3000',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(context).pop(controller.text),
            child: const Text('Save'),
          ),
        ],
      ),
    );

    if (result != null) {
      await setAgentBaseUrl(result);
      await _loadAgentBaseUrl();
      setState(() => _agentTestStatus = null);
    }
  }

  Future<void> _testAgentConnection() async {
    setState(() {
      _agentTesting = true;
      _agentTestStatus = null;
    });

    try {
      final baseUrl = await getAgentBaseUrl();
      final response = await http.get(Uri.parse('$baseUrl/api/health')).timeout(
            const Duration(seconds: 8),
          );
      if (!mounted) return;
      if (response.statusCode == 200) {
        setState(() {
          _agentTestStatus = '✅ Agent reachable at $baseUrl';
        });
      } else {
        setState(() {
          _agentTestStatus =
              '❌ Agent responded ${response.statusCode} at $baseUrl. ${_agentHelpText()}';
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _agentTestStatus =
            '❌ Failed to reach agent at $_agentBaseUrl. ${_agentHelpText()}';
      });
    } finally {
      if (mounted) {
        setState(() => _agentTesting = false);
      }
    }
  }

  Widget _buildAgentConnectionRow() {
    return Card(
      color: Colors.blueGrey.shade50,
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.link, color: Colors.blueGrey),
                const SizedBox(width: AppSpacing.sm),
                const Text(
                  'Agent Connection',
                  style: TextStyle(fontWeight: FontWeight.w600),
                ),
                const Spacer(),
                TextButton(
                  onPressed: _showAgentUrlDialog,
                  child: const Text('Change'),
                ),
                const SizedBox(width: AppSpacing.sm),
                ElevatedButton(
                  onPressed: _agentTesting ? null : _testAgentConnection,
                  child: _agentTesting
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Test'),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              _agentBaseUrl,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            if (_agentTestStatus != null) ...[
              const SizedBox(height: 6),
              Text(
                _agentTestStatus!,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: _agentTestStatus!.startsWith('✅')
                          ? Colors.green
                          : Colors.red,
                    ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _showPlayerSelector() async {
    await _preloadPlayerDirectory();
    final selected = await PlayerSelectorModal.show(
      context: context,
      directoryService: _playerDirectoryService,
      initialSelectedIds: _selectedPlayerIds,
      returnIds: true,
      allowedCategories: const [
        'You',
        'You and your buddies',
        'Members',
        'Guests'
      ],
      maxPlayers: _additionalPlayerCount,
      username: _brsUsernameController.text.trim(),
      password: _brsPasswordController.text,
    );

    if (selected != null) {
      setState(() {
        _selectedPlayerIds = selected;
        _isRefreshingPlayers = true;
      });

      // Refresh labels in the background; keep UI responsive.
      _playerDirectoryService
          .getDirectory(
        username: _brsUsernameController.text.trim(),
        password: _brsPasswordController.text,
      )
          .then((directory) {
        if (!mounted) return;
        final map = <String, String>{};
        if (directory != null) {
          for (final category in directory.categories) {
            for (final player in category.players) {
              map[player.id] = player.name;
            }
          }
        }
        setState(() {
          _playerLabelsById
            ..clear()
            ..addAll(map);
          _currentUserName = directory?.currentUserName;
          _isRefreshingPlayers = false;
        });
      }).catchError((_) {
        if (!mounted) return;
        setState(() => _isRefreshingPlayers = false);
      });
    }
  }

  Future<void> _preloadPlayerDirectory() async {
    if (_brsUsernameController.text.trim().isEmpty ||
        _brsPasswordController.text.isEmpty) {
      _showSnack('Enter BRS credentials to load player directory');
      return;
    }

    final baseUrl = await getAgentBaseUrl();
    debugPrint('🧭 [SniperWizard] Base URL: $baseUrl');
    debugPrint('🧭 [SniperWizard] Loading player directory...');
    final directory = await _playerDirectoryService.getDirectory(
      username: _brsUsernameController.text.trim(),
      password: _brsPasswordController.text,
    );
    if (directory == null) return;

    debugPrint(
        '✅ [SniperWizard] Player directory loaded: ${directory.getAllPlayers().length} players');

    final map = <String, String>{};
    for (final category in directory.categories) {
      for (final player in category.players) {
        map[player.id] = player.name;
      }
    }
    setState(() {
      _playerLabelsById
        ..clear()
        ..addAll(map);
      _currentUserName = directory.currentUserName;
    });
  }
}
