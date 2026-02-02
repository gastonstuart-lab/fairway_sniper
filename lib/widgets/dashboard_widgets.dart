import 'package:flutter/material.dart';
import 'package:fairway_sniper/models/booking_job.dart';
import 'package:fairway_sniper/models/booking_run.dart';
import 'package:fairway_sniper/services/booking_prefetch_service.dart';
import 'package:fairway_sniper/theme/app_colors.dart';
import 'package:fairway_sniper/theme/app_spacing.dart';
import 'package:intl/intl.dart';

/// Welcome card showing user greeting and BRS login status
class DashboardWelcomeCard extends StatelessWidget {
  final String? displayName;
  final Map<String, String>? savedCreds;
  final bool loadingCreds;
  final VoidCallback onEditCreds;
  final String? currentUserEmail;

  const DashboardWelcomeCard({
    super.key,
    required this.displayName,
    required this.savedCreds,
    required this.loadingCreds,
    required this.onEditCreds,
    required this.currentUserEmail,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final name = displayName?.trim().isNotEmpty == true
        ? displayName!.trim()
        : 'Welcome back';
    final hasCreds = savedCreds != null;

    return Card(
      color: Colors.white.withValues(alpha: 0.85),
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.waving_hand, color: AppColors.primaryGreen),
                const SizedBox(width: AppSpacing.sm),
                Text(
                  'Welcome back, $name',
                  style: theme.textTheme.titleMedium
                      ?.copyWith(fontWeight: FontWeight.w700, color: Colors.black87),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              hasCreds
                  ? 'BRS login saved. You can update it here if needed.'
                  : 'No BRS login saved yet. Add it to enable booking.',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: Colors.grey.shade700),
            ),
            const SizedBox(height: AppSpacing.md),
            Row(
              children: [
                FilledButton.icon(
                  onPressed: loadingCreds ? null : onEditCreds,
                  icon: const Icon(Icons.lock_outline, size: 18),
                  label: Text(hasCreds ? 'Edit BRS login' : 'Add BRS login'),
                ),
                const SizedBox(width: AppSpacing.md),
                if (loadingCreds)
                  const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Prefetch status card showing data preparation progress
class DashboardPrefetchCard extends StatelessWidget {
  final BookingPrefetchState state;
  final bool isRunning;
  final VoidCallback onRefresh;

  const DashboardPrefetchCard({
    super.key,
    required this.state,
    required this.isRunning,
    required this.onRefresh,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isReady = state.isReady;
    final hasError = state.hasError;
    final statusColor = isReady
        ? AppColors.success
        : hasError
            ? AppColors.error
            : theme.colorScheme.primary;

    return Card(
      color: Colors.white.withValues(alpha: 0.85),
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.data_saver_on, color: statusColor),
                const SizedBox(width: AppSpacing.sm),
                Text(
                  'Prepare Booking Data',
                  style: theme.textTheme.titleMedium
                      ?.copyWith(fontWeight: FontWeight.w600, color: Colors.black87),
                ),
                const Spacer(),
                TextButton(
                  onPressed: isRunning ? null : onRefresh,
                  child: const Text('Refresh Data'),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.sm),
            LinearProgressIndicator(
              value: state.step == PrefetchStep.failed ? null : state.progress,
              color: statusColor,
              backgroundColor: Colors.grey.shade200,
            ),
            const SizedBox(height: AppSpacing.sm),
            Row(
              children: [
                Expanded(
                  child: Text(
                    state.statusText,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: statusColor,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                Text(
                  '${(state.progress * 100).round()}%',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: Colors.grey.shade700,
                  ),
                ),
              ],
            ),
            if (hasError) ...[
              const SizedBox(height: 6),
              Text(
                'Prefetch failed. You can still use the app.',
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: Colors.grey.shade700),
              ),
              const SizedBox(height: AppSpacing.sm),
              ElevatedButton(
                onPressed: isRunning ? null : onRefresh,
                child: const Text('Retry'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Weather card showing current and forecast conditions
class DashboardWeatherCard extends StatelessWidget {
  final Map<String, dynamic>? currentWeather;
  final Map<String, dynamic>? weatherForecast;
  final BookingJob? activeJob;

  const DashboardWeatherCard({
    super.key,
    required this.currentWeather,
    required this.weatherForecast,
    required this.activeJob,
  });

  static String _getWeatherEmoji(int code) {
    if (code == 0 || code == 1) return '☀️';
    if (code == 2) return '⛅';
    if (code == 3) return '☁️';
    if (code == 45 || code == 48) return '🌫️';
    if (code >= 51 && code <= 67) return '🌧️';
    if (code >= 71 && code <= 77) return '❄️';
    if (code >= 80 && code <= 82) return '⛈️';
    if (code >= 85 && code <= 86) return '❄️⛈️';
    if (code == 80 || code == 81 || code == 82) return '🌧️';
    return '🌡️';
  }

  @override
  Widget build(BuildContext context) {
    if (currentWeather == null) {
      return const SizedBox.shrink();
    }

    final theme = Theme.of(context);
    final current = currentWeather!['current'];
    final currentWeatherCode = current['weathercode'] as int;
    final currentTemp = current['temperature_2m'];
    final currentWind = current['windspeed_10m'];
    final currentHumidity = current['relativehumidity_2m'];

    return Card(
      color: Colors.white.withValues(alpha: 0.85),
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  _getWeatherEmoji(currentWeatherCode),
                  style: const TextStyle(fontSize: 28),
                ),
                const SizedBox(width: AppSpacing.md),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Current Weather',
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                        color: Colors.black87,
                      ),
                    ),
                    Text(
                      '${currentTemp}°F',
                      style: theme.textTheme.bodyLarge
                          ?.copyWith(color: Colors.grey.shade700),
                    ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                Column(
                  children: [
                    Text('Wind',
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: Colors.grey.shade700,
                        )),
                    const SizedBox(height: AppSpacing.xs),
                    Text('${currentWind} mph',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                          color: Colors.black87,
                        )),
                  ],
                ),
                Column(
                  children: [
                    Text('Humidity',
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: Colors.grey.shade700,
                        )),
                    const SizedBox(height: AppSpacing.xs),
                    Text('$currentHumidity%',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                          color: Colors.black87,
                        )),
                  ],
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Active/completed jobs list with job cards
class DashboardJobsList extends StatelessWidget {
  final List<BookingJob> jobs;
  final VoidCallback onJobTap;

  const DashboardJobsList({
    super.key,
    required this.jobs,
    required this.onJobTap,
  });

  @override
  Widget build(BuildContext context) {
    if (jobs.isEmpty) {
      return Card(
        color: Colors.white.withValues(alpha: 0.85),
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.xxl),
          child: Column(
            children: [
              Icon(
                Icons.inbox,
                size: 48,
                color: Colors.grey.shade400,
              ),
              const SizedBox(height: AppSpacing.md),
              Text(
                'No booking jobs yet',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  color: Colors.black87,
                ),
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Create one to get started!',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: Colors.grey.shade700,
                ),
              ),
            ],
          ),
        ),
      );
    }

    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Your Booking Jobs',
          style: theme.textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.w600,
            color: Colors.black87,
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        ...jobs.map((job) => _buildJobCard(context, job)),
      ],
    );
  }

  Widget _buildJobCard(BuildContext context, BookingJob job) {
    final theme = Theme.of(context);
    final isActive = job.status == 'active';
    final statusColor =
        isActive ? AppColors.success : (job.status == 'completed' ? AppColors.info : Colors.orange);
    final playDate = job.targetPlayDate ?? DateTime.now();
    final playerCount = job.partySize ?? job.players.length;

    return Card(
      color: Colors.white.withValues(alpha: 0.85),
      margin: const EdgeInsets.only(bottom: AppSpacing.md),
      child: ListTile(
        title: Text(
          job.club,
          style: theme.textTheme.titleSmall?.copyWith(
            fontWeight: FontWeight.w600,
            color: Colors.black87,
          ),
        ),
        subtitle: Text(
          '${DateFormat('MMM d, yyyy').format(playDate)} • $playerCount player${playerCount > 1 ? 's' : ''}',
          style: theme.textTheme.bodySmall?.copyWith(
            color: Colors.grey.shade700,
          ),
        ),
        trailing: Chip(
          label: Text(
            job.status.toUpperCase(),
            style: const TextStyle(
              color: Colors.white,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
          backgroundColor: statusColor,
        ),
        onTap: onJobTap,
      ),
    );
  }
}

/// Local time display card
class LocalTimeCard extends StatefulWidget {
  final bool isDarkMode;

  const LocalTimeCard({super.key, required this.isDarkMode});

  @override
  State<LocalTimeCard> createState() => _LocalTimeCardState();
}

class _LocalTimeCardState extends State<LocalTimeCard> {
  late String _currentTime;

  @override
  void initState() {
    super.initState();
    _updateTime();
  }

  void _updateTime() {
    setState(() {
      _currentTime = DateFormat('hh:mm:ss a').format(DateTime.now());
    });
    Future.delayed(const Duration(seconds: 1), _updateTime);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      color: Colors.white.withValues(alpha: 0.85),
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Local Time',
              style: theme.textTheme.titleSmall?.copyWith(
                fontWeight: FontWeight.w600,
                color: Colors.black87,
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              _currentTime,
              style: theme.textTheme.displaySmall?.copyWith(
                fontFamily: 'Courier',
                color: Colors.black87,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Golf news carousel
class GolfNewsSection extends StatelessWidget {
  final List<Map<String, dynamic>>? newsArticles;
  final ScrollController scrollController;

  const GolfNewsSection({
    super.key,
    required this.newsArticles,
    required this.scrollController,
  });

  @override
  Widget build(BuildContext context) {
    if (newsArticles == null || newsArticles!.isEmpty) {
      return const SizedBox.shrink();
    }

    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
          child: Text(
            'Golf News',
            style: theme.textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w600,
              color: Colors.black87,
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        SizedBox(
          height: 160,
          child: ListView.builder(
            controller: scrollController,
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
            itemCount: newsArticles!.length,
            itemBuilder: (context, index) {
              final article = newsArticles![index];
              return Container(
                width: 300,
                margin: const EdgeInsets.only(right: AppSpacing.md),
                child: Card(
                  color: Colors.white.withValues(alpha: 0.85),
                  child: Padding(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          article['source'] ?? 'Golf News',
                          style: theme.textTheme.labelSmall?.copyWith(
                            color: Colors.grey.shade600,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: AppSpacing.xs),
                        Expanded(
                          child: Text(
                            article['title'] ?? 'No title',
                            style: theme.textTheme.bodySmall?.copyWith(
                              fontWeight: FontWeight.w500,
                              color: Colors.black87,
                            ),
                            maxLines: 3,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

/// Recent booking runs from API
class DashboardRecentRuns extends StatelessWidget {
  final List<BookingRun> runs;
  final String? courseName;

  const DashboardRecentRuns({
    super.key,
    required this.runs,
    required this.courseName,
  });

  @override
  Widget build(BuildContext context) {
    if (runs.isEmpty) {
      return const SizedBox.shrink();
    }

    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Recent Booking Runs',
          style: theme.textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.w600,
            color: Colors.black87,
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        Card(
          color: Colors.white.withValues(alpha: 0.85),
          child: ListView.separated(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: runs.length,
            separatorBuilder: (_, __) => const Divider(),
            itemBuilder: (context, index) {
              final run = runs[index];
              return ListTile(
                title: Text(
                  run.chosenTime ?? 'No time selected',
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w600,
                    color: Colors.black87,
                  ),
                ),
                subtitle: Text(
                  'Started: ${DateFormat('MMM d, h:mm a').format(run.startedUtc)}${run.finishedUtc != null ? ' • Finished: ${DateFormat('h:mm a').format(run.finishedUtc!)}' : ''}',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: Colors.grey.shade700,
                  ),
                ),
                trailing: Chip(
                  label: Text(
                    run.result.toUpperCase(),
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 11,
                    ),
                  ),
                  backgroundColor: run.result == 'success'
                      ? AppColors.success
                      : run.result == 'failed'
                          ? AppColors.error
                          : Colors.orange,
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}
