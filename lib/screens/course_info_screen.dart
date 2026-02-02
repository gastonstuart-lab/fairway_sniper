import 'package:flutter/material.dart';
import 'package:fairway_sniper/theme.dart';
import 'package:fairway_sniper/theme/app_spacing.dart';

class CourseInfoScreen extends StatelessWidget {
  const CourseInfoScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      decoration: const BoxDecoration(
        image: DecorationImage(
          image: AssetImage('assets/images/ultra-hd-golf-course-green-grass-o7ygl39odg1jxipx.jpg'),
          fit: BoxFit.cover,
        ),
      ),
      child: Scaffold(
        backgroundColor: Colors.transparent,
        appBar: AppBar(
          title: Text(
            'Galgorm Castle Golf Club',
            style: TextStyle(color: isDark ? Colors.white : Colors.black87),
          ),
          backgroundColor: (isDark ? Colors.black : Colors.white).withValues(alpha: 0.95),
          elevation: 2,
        ),
        body: SingleChildScrollView(
          child: Center(
            child: Container(
              constraints: const BoxConstraints(maxWidth: 1000),
              padding: const EdgeInsets.all(AppSpacing.xxl),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildCourseHeader(),
                  const SizedBox(height: AppSpacing.xl),
                  _buildCourseOverview(),
                  const SizedBox(height: AppSpacing.xl),
                  _buildScorecardSection(context),
                  const SizedBox(height: AppSpacing.xl),
                  _buildFacilitiesSection(),
                  const SizedBox(height: AppSpacing.xl),
                  _buildLocationSection(),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildCourseHeader() {
    return Card(
      elevation: 4,
      child: Container(
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: [Color(0xFF2E7D32), Color(0xFF43A047)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(12),
        ),
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.golf_course, color: Colors.white, size: 32),
                ),
                const SizedBox(width: AppSpacing.lg),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Galgorm Castle Golf Club',
                        style: TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                        ),
                      ),
                      SizedBox(height: 4),
                      Text(
                        'Ballymena, Northern Ireland',
                        style: TextStyle(
                          fontSize: 14,
                          color: Colors.white70,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.xl),
            Row(
              children: [
                _buildStatChip('18 Holes', Icons.flag),
                const SizedBox(width: AppSpacing.md),
                _buildStatChip('Par 72', Icons.star),
                const SizedBox(width: AppSpacing.md),
                _buildStatChip('7,121 yds', Icons.straighten),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatChip(String label, IconData icon) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.2),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: Colors.white, size: 16),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w600,
              fontSize: 13,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCourseOverview() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.info_outline, color: LightModeColors.lightPrimary),
                const SizedBox(width: 12),
                const Text(
                  'Course Overview',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            const Text(
              'Galgorm Castle Golf Club is a championship parkland golf course set in the heart of the stunning Galgorm Estate. Designed by Simon Gidman, the course opened in 1997 and has become one of Northern Ireland\'s premier golfing destinations.',
              style: TextStyle(fontSize: 15, height: 1.5),
            ),
            const SizedBox(height: 16),
            const Text(
              'The course features mature trees, natural water hazards, and challenging bunkers strategically placed throughout the layout. The River Maine winds through the property, coming into play on several memorable holes.',
              style: TextStyle(fontSize: 15, height: 1.5),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildScorecardSection(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.score, color: LightModeColors.lightPrimary),
                const SizedBox(width: 12),
                const Text(
                  'Scorecard',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
            _buildScorecardTable(isFront: true, isDark: isDark),
            const SizedBox(height: 24),
            _buildScorecardTable(isFront: false, isDark: isDark),
            const SizedBox(height: 20),
            _buildTotalsRow(),
          ],
        ),
      ),
    );
  }

  Widget _buildScorecardTable({required bool isFront, required bool isDark}) {
    final holes = isFront
        ? ['1', '2', '3', '4', '5', '6', '7', '8', '9']
        : ['10', '11', '12', '13', '14', '15', '16', '17', '18'];
    
    final yardages = isFront
        ? [422, 191, 534, 453, 383, 152, 412, 426, 369]
        : [414, 412, 208, 503, 367, 180, 581, 458, 449];
    
    final pars = isFront
        ? [4, 3, 5, 4, 4, 3, 4, 4, 4]
        : [4, 4, 3, 5, 4, 3, 5, 4, 4];
    
    final strokeIndexes = isFront
        ? [7, 15, 3, 1, 11, 17, 9, 5, 13]
        : [8, 6, 16, 2, 12, 18, 4, 10, 14];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          isFront ? 'Front Nine' : 'Back Nine',
          style: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
            color: Color(0xFF2E7D32),
          ),
        ),
        const SizedBox(height: 12),
        Container(
          decoration: BoxDecoration(
            border: Border.all(
              color: isDark ? Colors.grey.shade700 : Colors.grey.shade300,
            ),
            borderRadius: BorderRadius.circular(8),
          ),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: IntrinsicWidth(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _buildScrollableRow(['Hole', ...holes, isFront ? 'Out' : 'In'], isHeader: true, isDark: isDark, headerBg: true),
                  _buildScrollableRow(['Yds', ...yardages.map((y) => y.toString()), yardages.reduce((a, b) => a + b).toString()], isDark: isDark),
                  _buildScrollableRow(['Par', ...pars.map((p) => p.toString()), pars.reduce((a, b) => a + b).toString()], isDark: isDark, parBg: true, isBold: true),
                  _buildScrollableRow(['SI', ...strokeIndexes.map((si) => si.toString()), '-'], isDark: isDark, isSmall: true),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildScrollableRow(List<String> cells, {bool isHeader = false, bool isDark = false, bool headerBg = false, bool parBg = false, bool isBold = false, bool isSmall = false}) {
    return Container(
      decoration: BoxDecoration(
        color: headerBg 
          ? (isDark ? Colors.grey.shade800 : Colors.grey.shade100)
          : parBg 
            ? (isDark ? Colors.green.shade900 : Colors.green.shade50)
            : Colors.transparent,
        border: Border(
          bottom: BorderSide(
            color: isDark ? Colors.grey.shade700 : Colors.grey.shade300,
            width: 0.5,
          ),
        ),
      ),
      child: Row(
        children: List.generate(cells.length, (index) {
          final isFirstCol = index == 0;
          final isLastCol = index == cells.length - 1;
          
          Color textColor;
          if (isFirstCol || isHeader) {
            textColor = const Color(0xFF2E7D32);
          } else if (isLastCol) {
            textColor = const Color(0xFFF57C00);
          } else {
            textColor = isDark ? Colors.white : Colors.black87;
          }

          return Container(
            width: 60,
            padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
            decoration: BoxDecoration(
              border: Border(
                right: index < cells.length - 1
                  ? BorderSide(
                      color: isDark ? Colors.grey.shade700 : Colors.grey.shade300,
                      width: 0.5,
                    )
                  : BorderSide.none,
              ),
            ),
            child: Center(
              child: Text(
                cells[index],
                style: TextStyle(
                  fontWeight: isFirstCol || isLastCol || isBold ? FontWeight.bold : FontWeight.normal,
                  fontSize: isSmall ? 11 : 13,
                  color: textColor,
                ),
              ),
            ),
          );
        }),
      ),
    );
  }

  Widget _buildTotalsRow() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFFFFD700), Color(0xFFFFA000)],
        ),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _buildTotalStat('Total Yards', '7,121'),
          Container(width: 1, height: 30, color: Colors.white.withValues(alpha: 0.3)),
          _buildTotalStat('Total Par', '72'),
          Container(width: 1, height: 30, color: Colors.white.withValues(alpha: 0.3)),
          _buildTotalStat('Course Rating', '74.2'),
        ],
      ),
    );
  }

  Widget _buildTotalStat(String label, String value) {
    return Column(
      children: [
        Text(
          value,
          style: const TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.bold,
            color: Colors.white,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          label,
          style: const TextStyle(
            fontSize: 12,
            color: Colors.white70,
          ),
        ),
      ],
    );
  }

  Widget _buildFacilitiesSection() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.local_activity, color: LightModeColors.lightPrimary),
                const SizedBox(width: 12),
                const Text(
                  'Facilities',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [
                _buildFacilityChip('Pro Shop', Icons.store),
                _buildFacilityChip('Driving Range', Icons.sports_golf),
                _buildFacilityChip('Putting Green', Icons.circle),
                _buildFacilityChip('Clubhouse', Icons.house),
                _buildFacilityChip('Restaurant', Icons.restaurant),
                _buildFacilityChip('Bar', Icons.local_bar),
                _buildFacilityChip('Locker Rooms', Icons.door_sliding),
                _buildFacilityChip('Cart Rental', Icons.directions_car),
                _buildFacilityChip('Club Hire', Icons.golf_course),
                _buildFacilityChip('Practice Bunker', Icons.landscape),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFacilityChip(String label, IconData icon) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xFF2E7D32).withValues(alpha: 0.1),
        border: Border.all(color: const Color(0xFF2E7D32).withValues(alpha: 0.3)),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: const Color(0xFF2E7D32)),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w500,
              color: Color(0xFF2E7D32),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLocationSection() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.location_on, color: LightModeColors.lightPrimary),
                const SizedBox(width: 12),
                const Text(
                  'Location & Contact',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            _buildInfoRow(Icons.place, '200 Fenaghy Road, Ballymena, BT42 1HL'),
            const SizedBox(height: 12),
            _buildInfoRow(Icons.phone, '+44 28 2564 6161'),
            const SizedBox(height: 12),
            _buildInfoRow(Icons.email, 'golf@galgorm.com'),
            const SizedBox(height: 12),
            _buildInfoRow(Icons.language, 'www.galgorm.com/golf'),
          ],
        ),
      ),
    );
  }

  Widget _buildInfoRow(IconData icon, String text) {
    return Row(
      children: [
        Icon(icon, size: 20, color: Colors.grey.shade600),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            text,
            style: const TextStyle(fontSize: 14),
          ),
        ),
      ],
    );
  }
}
