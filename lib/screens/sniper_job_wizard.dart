import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:fairway_sniper/models/booking_job.dart';
import 'package:fairway_sniper/services/firebase_service.dart';
import 'package:fairway_sniper/services/player_directory_service.dart';
import 'package:fairway_sniper/services/agent_base_url.dart';
import 'package:fairway_sniper/services/availability_cache_service.dart';
import 'package:fairway_sniper/widgets/player_selector_modal.dart';
import 'package:fairway_sniper/widgets/player_list_editor.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'dart:async';

class SniperJobWizard extends StatefulWidget {
  const SniperJobWizard({super.key});

  @override
  State<SniperJobWizard> createState() => _SniperJobWizardState();
}

class _SniperJobWizardState extends State<SniperJobWizard> {
  final _firebaseService = FirebaseService();
  late final PlayerDirectoryService _playerDirectoryService;
  final _availabilityCacheService = AvailabilityCacheService();
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
  String _agentBaseUrl = defaultAgentBaseUrl();
  bool _agentTesting = false;
  String? _agentTestStatus;
  bool _isRefreshingPlayers = false;
  bool _isNextBusy = false;
  String? _sniperTestJobId;
  String? _sniperTestStatus;
  Timer? _sniperTestPoller;
  bool _sniperTestRunning = false;

  int get _partySize => _additionalPlayerCount + 1;
  bool _agentHealthOk = true;
  String? _agentHealthBaseUrl;

  final List<String> _fallbackTimes = [
    '08:00',
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
    '16:10',
    '16:20',
    '16:30'
  ];

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
    };
    print('🚨🚨 [AGENT-DIAG] FETCH URL: $fetchUrl');
    try {
      final response = await http.post(
        Uri.parse(fetchUrl),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(payload),
      );
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
    final now = DateTime.now();
    // Must be at least 5 days in future (releases 5 days before at 7:20 PM)
    final minDate = now.add(const Duration(days: 5));
    final minDay = DateTime(minDate.year, minDate.month, minDate.day);
    final candidateDay = DateTime(date.year, date.month, date.day);
    return candidateDay.isAtSameMomentAs(minDay) ||
        candidateDay.isAfter(minDay);
  }

  DateTime _computeReleaseDateTime(DateTime targetPlayDate) {
    // Release is always 5 days before target at 19:20 UK time
    final releaseDate = targetPlayDate.subtract(const Duration(days: 5));
    return DateTime(
        releaseDate.year, releaseDate.month, releaseDate.day, 19, 20);
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
      if (!_isValidSniperDate(_targetPlayDate!)) {
        _showSnack('Date must be at least 5 days in future');
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
      if (_additionalPlayerCount > 0 && _selectedPlayerIds.isEmpty) {
        _showSnack('Select at least one additional player');
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
    if (uid == null) return;

    // Use selected players from directory
    final players = _selectedPlayerIds;

    final strategy = _buildStrategy();
    final releaseDateTime = _computeReleaseDateTime(_targetPlayDate!);

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
      targetPlayDate: _targetPlayDate,
      releaseWindowStart: releaseDateTime.toUtc(),
      snipeStrategy: strategy,
    );

    try {
      await _firebaseService.saveBRSCredentials(
          uid, _brsUsernameController.text.trim(), _brsPasswordController.text,
          club: _club);
      final id = await _firebaseService.createJob(job);
      if (!mounted) return;
      Navigator.of(context).pop();
      _showSnack('Sniper job created (ID: $id)');
    } catch (e) {
      _showSnack('Error saving job: $e');
    }
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

      // Try cached availability first
      final cacheKey = _availabilityCacheService.buildKey(
        baseUrl: agentUrl,
        username: _brsUsernameController.text.trim(),
        days: 5,
        club: _club,
      );
      final cached = _availabilityCacheService.getFresh(cacheKey);
      if (cached != null) {
        final cachedDay = cached.days.firstWhere(
          (d) => d['date']?.toString() == dateStr,
          orElse: () => {},
        );
        if (cachedDay.isNotEmpty && cachedDay['times'] is List) {
          final times = (cachedDay['times'] as List)
              .map((t) => t.toString())
              .toList();
          setState(() {
            _availableTimes = times.isEmpty ? _fallbackTimes : times;
          });
          return;
        }
      }

      final response = await http.post(
        Uri.parse('$agentUrl/api/fetch-tee-times'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'date': dateStr,
          'username': _brsUsernameController.text.trim(),
          'password': _brsPasswordController.text,
        }),
      );

      if (!mounted) return;

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        final List<dynamic> times = data['times'] ?? [];

        setState(() {
          _availableTimes = times.cast<String>();

          if (_availableTimes.isEmpty) {
            // For sniper mode, use fallback times since target date isn't released yet
            _availableTimes = _fallbackTimes;
          }
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Sniper Booking Wizard'),
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
            onPressed: _saveJob,
            child: const Text('Save',
                style: TextStyle(
                    color: Colors.white, fontWeight: FontWeight.bold)),
          )
        ],
      ),
      body: Column(
        children: [
          if (!_agentHealthOk && _agentHealthBaseUrl != null)
            Container(
              width: double.infinity,
              padding:
                  const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              color: Colors.red.shade700,
              child: Text(
                'AGENT NOT RUNNING at $_agentHealthBaseUrl',
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                ),
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
          _buildNavBar(),
        ],
      ),
    );
  }

  Widget _buildStepper() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
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
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          Expanded(
            child: OutlinedButton(
              onPressed: _currentPage == 0 || _isNextBusy ? null : _prevPage,
              child: const Text('Back'),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: ElevatedButton(
              onPressed:
                  _isNextBusy ? null : (_currentPage == 4 ? _saveJob : _nextPage),
              child: _isNextBusy
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(_currentPage == 4 ? 'Create Job' : 'Continue'),
            ),
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
    _startSniperTestPolling(jobId);
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
    final time =
        _preferredTimes.isNotEmpty ? _preferredTimes.first : _availableTimes.first;

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
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.lock_outline, size: 56, color: Colors.redAccent),
          const SizedBox(height: 16),
          Text('BRS Credentials',
              style: Theme.of(context)
                  .textTheme
                  .headlineSmall
                  ?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Text('Needed to log in instantly at release time.',
              style: Theme.of(context).textTheme.bodyMedium),
          const SizedBox(height: 16),
          if (_loadingCreds)
            const LinearProgressIndicator()
          else if (_savedCreds != null)
            _savedCredBanner()
          else
            _noCredsBanner(),
          const SizedBox(height: 24),
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
          const SizedBox(height: 16),
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
          const SizedBox(height: 24),
          _buildAgentConnectionRow(),
          if (kDebugMode && _sniperTestJobId != null) ...[
            const SizedBox(height: 16),
            Card(
              color: Colors.blueGrey.shade50,
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Sniper Test Status',
                      style: TextStyle(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Job: $_sniperTestJobId',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    if (_sniperTestStatus != null) ...[
                      const SizedBox(height: 4),
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
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            const Icon(Icons.check_circle, color: Colors.green),
            const SizedBox(width: 12),
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
        padding: const EdgeInsets.all(12),
        child: Row(children: [
          const Icon(Icons.info_outline, color: Colors.orange),
          const SizedBox(width: 12),
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
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.event, size: 56, color: Colors.redAccent),
          const SizedBox(height: 16),
          Text('Target Play Date',
              style: Theme.of(context)
                  .textTheme
                  .headlineSmall
                  ?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Text(
              'Tee sheets release 5 days before at 7:20 PM UK time. Pick your target play date.',
              style: Theme.of(context).textTheme.bodyMedium),
          const SizedBox(height: 24),
          InkWell(
            onTap: () async {
              final now = DateTime.now();
              final minDate = now.add(const Duration(days: 5));
              final picked = await showDatePicker(
                context: context,
                firstDate: minDate,
                lastDate: now.add(const Duration(days: 90)),
                initialDate: minDate,
              );
              if (picked != null) {
                setState(() {
                  _targetPlayDate = picked;
                  _computedReleaseDateTime = _computeReleaseDateTime(picked);
                });
              }
            },
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                        _targetPlayDate == null
                            ? 'Tap to choose date'
                            : DateFormat('EEE, MMM d').format(_targetPlayDate!),
                        style: const TextStyle(fontSize: 16)),
                    const Icon(Icons.calendar_today)
                  ],
                ),
              ),
            ),
          ),
          if (_targetPlayDate != null) ...[
            const SizedBox(height: 24),
            Card(
              color: Colors.blue.shade50,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.access_time, color: Colors.blue),
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
                    const SizedBox(height: 8),
                    Text(
                      'Booking opens: ${DateFormat("EEEE, MMM d 'at' h:mm a").format(_computedReleaseDateTime ?? DateTime.now())}',
                      style: Theme.of(context)
                          .textTheme
                          .bodyMedium
                          ?.copyWith(color: Colors.blue.shade800),
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
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.schedule, size: 56, color: Colors.redAccent),
          const SizedBox(height: 16),
          Text('Preferred Tee Times',
              style: Theme.of(context)
                  .textTheme
                  .headlineSmall
                  ?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Text('Pick up to 3 target times in order of preference.',
              style: Theme.of(context).textTheme.bodyMedium),
          const SizedBox(height: 8),
          if (_targetPlayDate != null)
            Text(
              'Available times for ${DateFormat('EEE d MMM').format(_targetPlayDate!)}',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Colors.grey.shade600,
                  ),
            ),
          const SizedBox(height: 24),
          if (_preferredTimes.isNotEmpty) ...[
            Text('Selected', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            ...List.generate(
                _preferredTimes.length,
                (i) => Card(
                      child: ListTile(
                        leading: CircleAvatar(child: Text('${i + 1}')),
                        title: Text(_preferredTimes[i]),
                        trailing: IconButton(
                            icon: const Icon(Icons.delete),
                            onPressed: () =>
                                setState(() => _preferredTimes.removeAt(i))),
                      ),
                    )),
            const SizedBox(height: 16),
          ],
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: _availableTimes
                .where((t) => !_preferredTimes.contains(t))
                .map((t) => ActionChip(
                      label: Text(t),
                      onPressed: () {
                        if (_preferredTimes.length < 3)
                          setState(() => _preferredTimes.add(t));
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
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.group, size: 56, color: Colors.redAccent),
          const SizedBox(height: 16),
          Text('Additional Players',
              style: Theme.of(context)
                  .textTheme
                  .headlineSmall
                  ?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Text('How many additional players?',
              style: Theme.of(context).textTheme.bodyMedium),
          const SizedBox(height: 24),
          Wrap(
            spacing: 12,
            children: [0, 1, 2, 3]
                .map((count) => ChoiceChip(
                      label: Text('$count'),
                      selected: _additionalPlayerCount == count,
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
          const SizedBox(height: 16),
          Text(
            'You will select up to $_additionalPlayerCount additional player(s).',
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: Colors.grey.shade600),
          ),
        ],
      ),
    );
  }

  Widget _buildPlayersPage() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.group, size: 56, color: Colors.redAccent),
          const SizedBox(height: 16),
          Text('Select Players',
              style: Theme.of(context)
                  .textTheme
                  .headlineSmall
                  ?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Text(
              'Choose up to $_additionalPlayerCount additional player(s) from your club directory',
              style: Theme.of(context).textTheme.bodyMedium),
          const SizedBox(height: 12),
          if (_currentUserName != null && _currentUserName!.isNotEmpty)
            Text(
              'Player 1: $_currentUserName',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
            ),
          const SizedBox(height: 24),
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
      final response =
          await http.get(Uri.parse('$baseUrl/api/health')).timeout(
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
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.link, color: Colors.blueGrey),
                const SizedBox(width: 8),
                const Text(
                  'Agent Connection',
                  style: TextStyle(fontWeight: FontWeight.w600),
                ),
                const Spacer(),
                TextButton(
                  onPressed: _showAgentUrlDialog,
                  child: const Text('Change'),
                ),
                const SizedBox(width: 8),
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
      allowedCategories: const ['You and your buddies', 'Other club members'],
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
