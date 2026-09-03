import 'package:flutter/material.dart';
import 'package:mobile/core/configs/app_colors.dart';
import 'package:mobile/core/configs/app_images.dart';
import 'package:mobile/presentation/root/root.dart';

class OnboardingPage extends StatefulWidget {
  const new({super.key});

  @override
  State<OnboardingPage> createState() => _OnboardingPageState();
}

class _OnboardingPageState extends State<OnboardingPage> {
  final PageController _pageController = PageController();

  int _activePage = 0;
  @override
  void dispose() {
    super.dispose();
    _pageController.dispose();
  }

  final List<Map<String, String>> _pagesInfo = [
    {
      "title": "Fan of board games or party games?",
      "hook": "Tired of your friends constantly asking you for the score?",
    },
    {
      "title": "Now everyone gets their own leaderboard",
      "hook":
          "Easy to change, and your friends will see the changes in real time!",
    },
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          PageView.builder(
            controller: _pageController,
            onPageChanged: (int page) {
              setState(() {
                _activePage = page;
              });
            },
            itemCount: AppImages.onboardingImage.length,
            itemBuilder: (BuildContext context, int index) {
              return _page(
                context,
                index,
                _pagesInfo[index]['title']!,
                _pagesInfo[index]['hook']!,
              );
            },
          ),
          Positioned(
            bottom: 80,
            left: 0,
            right: 0,
            child: Row(
              mainAxisAlignment: .center,
              spacing: 8,
              children: _indictators(context),
            ),
          ),
        ],
      ),
    );
  }

  Widget _page(BuildContext context, int index, String title, String hook) {
    return Stack(
      children: [
        Container(
          padding: const EdgeInsetsGeometry.symmetric(
            vertical: 40,
            horizontal: 40,
          ),
          decoration: BoxDecoration(
            image: DecorationImage(
              fit: .fitHeight,
              image: AssetImage(AppImages.onboardingImage[index]),
            ),
          ),
        ),
        Container(color: Colors.black.withAlpha(100)),
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24.0),
            child: Column(
              mainAxisAlignment: .center,
              crossAxisAlignment: .center,
              children: [
                Text(
                  title,
                  textAlign: .center,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 24,
                    fontWeight: .bold,
                  ),
                ),
                const SizedBox(height: 64),
                Text(
                  hook,
                  textAlign: .center,
                  style: const TextStyle(
                    color: AppColors.darkGrey,
                    fontSize: 16,
                    fontWeight: .w500,
                  ),
                ),
                const SizedBox(height: 64),
                if (index == _pagesInfo.length - 1)
                  ElevatedButton(
                    onPressed: () {
                      Navigator.pushAndRemoveUntil(
                        context,
                        MaterialPageRoute(
                          builder: (BuildContext context) => const RootPage(),
                        ),
                        ((route) => false),
                      );
                    },
                    child: const Text("Get Started!"),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  List<Widget> _indictators(BuildContext context) {
    List<Widget> indicators = [];
    for (int i = 0; i < _pagesInfo.length; i++) {
      indicators.add(_indicator(context, i));
    }
    return indicators;
  }

  Widget _indicator(BuildContext context, int index) {
    return AnimatedContainer(
      height: 16,
      width: 16,
      duration: const Duration(milliseconds: 500),
      decoration: BoxDecoration(
        color: index == _activePage ? AppColors.primary : Colors.transparent,
        borderRadius: BorderRadiusGeometry.circular(0),
        border: .all(color: AppColors.primary, width: 0.4),
      ),
    );
  }
}
