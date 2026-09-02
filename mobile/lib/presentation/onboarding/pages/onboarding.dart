import 'package:flutter/material.dart';
import 'package:mobile/core/configs/app_colors.dart';
import 'package:mobile/core/configs/app_images.dart';
import 'package:mobile/presentation/root/root.dart';

class OnboardingPage extends StatelessWidget {
  new({super.key});

  final PageController _pageController = PageController();
  final List<Map<String, String>> pagesInfo = [
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
      body: PageView.builder(
        controller: _pageController,
        itemCount: AppImages.onboardingImage.length,
        itemBuilder: (BuildContext context, int index) {
          return _page(
            context,
            index,
            pagesInfo[index]['title']!,
            pagesInfo[index]['hook']!,
          );
        },
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
              const SizedBox(height: 32),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 32.0),
                child: Text(
                  hook,
                  textAlign: .center,
                  style: const TextStyle(
                    color: AppColors.darkGrey,
                    fontSize: 16,
                    fontWeight: .w500,
                  ),
                ),
              ),
              const SizedBox(height: 32),
              if (index == pagesInfo.length - 1)
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
      ],
    );
  }
}
