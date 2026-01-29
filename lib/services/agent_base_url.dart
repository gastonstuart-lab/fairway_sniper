import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _agentBaseUrlKey = 'agent_base_url';

String _sanitizeAgentBaseUrl(String url) {
  final trimmed = url.trim();
  if (trimmed.endsWith('/')) {
    return trimmed.substring(0, trimmed.length - 1);
  }
  return trimmed;
}

/// Default base URL based on platform, unless overridden via --dart-define.
String defaultAgentBaseUrl() {
  const override = String.fromEnvironment('AGENT_BASE_URL', defaultValue: '');
  if (override.isNotEmpty) {
    return _sanitizeAgentBaseUrl(override);
  }

  if (kIsWeb) {
    return 'http://localhost:3000';
  }

  switch (defaultTargetPlatform) {
    case TargetPlatform.android:
      return 'http://10.0.2.2:3000';
    case TargetPlatform.iOS:
    case TargetPlatform.macOS:
    case TargetPlatform.windows:
    case TargetPlatform.linux:
    case TargetPlatform.fuchsia:
      return 'http://localhost:3000';
  }
}

/// Get the current base URL with priority:
/// 1) --dart-define=AGENT_BASE_URL
/// 2) User-saved preference
/// 3) Platform default
Future<String> getAgentBaseUrl() async {
  const override = String.fromEnvironment('AGENT_BASE_URL', defaultValue: '');
  if (override.isNotEmpty) {
    return _sanitizeAgentBaseUrl(override);
  }

  final prefs = await SharedPreferences.getInstance();
  final saved = prefs.getString(_agentBaseUrlKey);
  if (saved != null && saved.trim().isNotEmpty) {
    return _sanitizeAgentBaseUrl(saved);
  }
  return defaultAgentBaseUrl();
}

/// Persist a user-specified base URL.
Future<void> setAgentBaseUrl(String url) async {
  final prefs = await SharedPreferences.getInstance();
  final sanitized = _sanitizeAgentBaseUrl(url);
  if (sanitized.isEmpty) {
    await prefs.remove(_agentBaseUrlKey);
    return;
  }
  await prefs.setString(_agentBaseUrlKey, sanitized);
}
