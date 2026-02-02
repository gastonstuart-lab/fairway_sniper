# Fairway Sniper - PHASE 2 ACTION GUIDE

**Goal:** Complete dashboard refactor + design system rollout  
**Timeline:** 3-4 hours  
**Impact:** Quality score 6.5 → 8+/10

---

## CRITICAL PATH

### Step 1: Extract Dashboard Widgets (2 hours)

**Current:** `dashboard_screen.dart` (2785 lines in ONE file)  
**Target:** `dashboard_screen.dart` (400 lines) + 6 separate widgets

#### Create These Files:

**1. `lib/widgets/dashboard_welcome_card.dart`**
```dart
class DashboardWelcomeCard extends StatelessWidget {
  final String displayName;
  final bool hasSavedCreds;
  final VoidCallback onEditCreds;
  final bool isLoading;

  const DashboardWelcomeCard({...});
  
  @override
  Widget build(BuildContext context) { ... }
}
```
**Extract from:** Lines 473-523 in current dashboard

**2. `lib/widgets/dashboard_prefetch_card.dart`**
```dart
class DashboardPrefetchCard extends StatelessWidget {
  final BookingPrefetchState state;
  final VoidCallback onRefresh;
  final bool isRunning;

  const DashboardPrefetchCard({...});
  
  @override
  Widget build(BuildContext context) { ... }
}
```
**Extract from:** Lines 525-590 in current dashboard

**3. `lib/widgets/dashboard_job_card.dart`**
```dart
class DashboardJobCard extends StatelessWidget {
  final BookingJob job;
  final BookingRun? lastRun;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const DashboardJobCard({...});
  
  @override
  Widget build(BuildContext context) { ... }
}
```
**Extract from:** Job card rendering logic (find in `_buildJobsList`)

**4. `lib/widgets/dashboard_weather_card.dart`**
```dart
class DashboardWeatherCard extends StatelessWidget {
  final Map<String, dynamic>? weather;
  final List<BookingJob> jobs;
  final bool isDarkMode;

  const DashboardWeatherCard({...});
  
  @override
  Widget build(BuildContext context) { ... }
}
```
**Extract from:** Lines ~750-850 in current dashboard

**5. `lib/widgets/dashboard_news_section.dart`**
```dart
class DashboardNewsSection extends StatefulWidget {
  final List<Map<String, dynamic>> newsItems;

  const DashboardNewsSection({...});
  
  @override
  State<DashboardNewsSection> createState() => _DashboardNewsSectionState();
}
```
**Extract from:** Lines ~850-950 in current dashboard

**6. `lib/widgets/dashboard_recent_runs.dart`**
```dart
class DashboardRecentRuns extends StatelessWidget {
  final String userId;

  const DashboardRecentRuns({...});
  
  @override
  Widget build(BuildContext context) { ... }
}
```
**Extract from:** `_buildRecentRuns()` method

#### Result:
```
dashboard_screen.dart: 2785 lines → 400 lines ✅
+ 6 new focused widget files (100-150 lines each)
= Better maintainability, easier testing, clearer responsibilities
```

---

### Step 2: Standardize Color References (45 min)

**Find & Replace in ALL files:**

```dart
// Pattern 1: Hardcoded green
Color(0xFF2E7D32)           → AppColors.primaryGreen
Color(0xFF43A047)           → AppColors.primaryGreenLight
Color(0xFF1B5E20)           → AppColors.primaryGreenDark

// Pattern 2: Colors.green
Colors.green                → AppColors.primaryGreen
Colors.green.shade50        → AppColors.getGreenShade(50)
Colors.green.shade700       → AppColors.getGreenShade(700)

// Pattern 3: Semantic colors (if used)
Colors.red                  → AppColors.error
Colors.green                → AppColors.success
Colors.orange               → AppColors.warning
Colors.blue                 → AppColors.info

// Pattern 4: Material colors to custom
Colors.white.withOpacity(.95) → AppColors.white.withValues(alpha: 0.95)
Colors.black.withOpacity(.5)  → AppColors.black.withValues(alpha: 0.5)
```

**Files to Update (7):**
- [ ] lib/screens/login_screen.dart (minor)
- [ ] lib/screens/mode_selection_screen.dart (minor)
- [ ] lib/screens/dashboard_screen.dart (major - many refs)
- [ ] lib/screens/new_job_wizard.dart (some refs)
- [ ] lib/screens/sniper_job_wizard.dart (some refs)
- [ ] lib/screens/course_info_screen.dart (minor)
- [ ] lib/screens/admin_dashboard.dart (already done ✅)

**Expected result:** No hardcoded green colors in app

---

### Step 3: Apply Spacing Scale (45 min)

**Find & Replace in ALL files:**

```dart
// Padding patterns
EdgeInsets.all(16)          → EdgeInsets.all(AppSpacing.lg)
EdgeInsets.all(24)          → EdgeInsets.all(AppSpacing.xl)
EdgeInsets.all(32)          → EdgeInsets.all(AppSpacing.xxl)
EdgeInsets.symmetric(horizontal: 16)  → EdgeInsets.symmetric(horizontal: AppSpacing.lg)
EdgeInsets.only(top: 16)    → EdgeInsets.only(top: AppSpacing.lg)

// SizedBox patterns
SizedBox(height: 16)        → SizedBox(height: AppSpacing.lg)
SizedBox(height: 24)        → SizedBox(height: AppSpacing.xl)
SizedBox(height: 12)        → SizedBox(height: AppSpacing.md)
SizedBox(width: 12)         → SizedBox(width: AppSpacing.md)

// BorderRadius patterns
BorderRadius.circular(12)   → BorderRadius.circular(AppBorderRadius.md)
BorderRadius.circular(16)   → BorderRadius.circular(AppBorderRadius.lg)
BorderRadius.circular(20)   → BorderRadius.circular(AppBorderRadius.xl)

// Elevation patterns (if hardcoded)
elevation: 4                → elevation: AppElevation.standard
elevation: 8                → elevation: AppElevation.elevated
```

**Files to Update (7):** Same as Step 2

**Expected result:** Consistent spacing throughout app, responsive design ready

---

### Step 4: Consolidate Modal Styling (30 min)

**File to Create:** `lib/widgets/app_dialog_wrapper.dart`

```dart
/// Standardized dialog wrapper ensuring consistent styling
Widget buildAppDialog({
  required BuildContext context,
  required String title,
  required Widget content,
  required List<Widget> actions,
  bool isDismissible = true,
}) {
  return AlertDialog(
    title: Text(
      title,
      style: Theme.of(context).textTheme.titleLarge?.copyWith(
        fontWeight: FontWeight.bold,
      ),
    ),
    content: content,
    contentPadding: EdgeInsets.all(AppSpacing.lg),
    actionsPadding: EdgeInsets.all(AppSpacing.lg),
    actions: actions,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(AppBorderRadius.lg),
    ),
  );
}
```

**Update:** Use this wrapper in credential modal + any other dialogs

**Expected result:** All modals look identical, easier to maintain

---

### Step 5: Add Missing Imports (15 min)

**Add to files using new design system:**

```dart
import 'package:fairway_sniper/theme/app_colors.dart';
import 'package:fairway_sniper/theme/app_spacing.dart';
```

**Files needing imports:**
- [ ] login_screen.dart
- [ ] mode_selection_screen.dart
- [ ] dashboard_screen.dart (+ new widgets)
- [ ] new_job_wizard.dart
- [ ] sniper_job_wizard.dart
- [ ] course_info_screen.dart
- [ ] admin_dashboard.dart (already has implicit use)
- [ ] All new dashboard widget files

---

## QUICK REFERENCE: Most Common Changes

```dart
// BEFORE (inconsistent)
padding: EdgeInsets.all(16),
color: Color(0xFF2E7D32),
borderRadius: BorderRadius.circular(12),

// AFTER (standardized)
padding: EdgeInsets.all(AppSpacing.lg),
color: AppColors.primaryGreen,
borderRadius: BorderRadius.circular(AppBorderRadius.md),
```

---

## VALIDATION CHECKLIST

After completing Phase 2:

- [ ] Dashboard compiles without errors
- [ ] All 6 dashboard widgets render correctly
- [ ] No purple colors visible anywhere in app
- [ ] Spacing consistent throughout (visual inspection)
- [ ] Modal dialogs all have same appearance
- [ ] No hardcoded `Color(0xFF...)` literals remain
- [ ] App runs on test device without crashes
- [ ] Credential modal still works (test in mode_selection)
- [ ] Draft recovery still works (test in normal wizard)

---

## EXPECTED QUALITY IMPROVEMENTS

| Metric | Before Phase 2 | After Phase 2 | Target |
|--------|---|---|---|
| Codebase maintainability | 6/10 | 8/10 | 9/10 |
| Visual consistency | 6/10 | 8/10 | 9/10 |
| Design system usage | 30% | 95% | 100% |
| Largest file size | 2785 lines | 400 lines | < 500 |
| Component reusability | 3/10 | 7/10 | 9/10 |
| **Overall Quality Score** | **6.5/10** | **8.0/10** | **9.0/10** |

---

## TIME ESTIMATES

| Task | Effort | Complexity | Risk |
|------|--------|-----------|------|
| Extract dashboard widgets | 2h | HIGH | MEDIUM |
| Standardize colors | 45min | MEDIUM | LOW |
| Apply spacing scale | 45min | MEDIUM | LOW |
| Consolidate modals | 30min | LOW | LOW |
| Add imports | 15min | LOW | LOW |
| Testing & validation | 30min | LOW | LOW |
| **TOTAL** | **4.5h** | - | - |

---

## IF SHORT ON TIME: MINIMUM VIABLE IMPROVEMENTS

**Do these 3 things in order (2 hours total):**

1. **Extract dashboard widgets** (1.5h) - CRITICAL for maintainability
2. **Standardize color references** (30min) - CRITICAL for consistency
3. **Apply spacing scale** (30min) - Nice-to-have but improves polish

This will get quality to 7.5/10 and address the worst issues.

---

## NEXT SESSION AFTER PHASE 2

- [ ] Phase 3: UX Polish (loading states, error handling, animations)
- [ ] Phase 4: Accessibility (semantic labels, contrast fixes)
- [ ] Phase 5: Final testing & deployment readiness
- [ ] Phase 6: App Store submission (when all phases complete)

