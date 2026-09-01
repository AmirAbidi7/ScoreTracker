import 'package:flutter/material.dart';
import 'package:mobile/presentation/onboarding/pages/onboarding.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

void main() async {
  await Supabase.initialize(
    url: 'https://tcpwwhwobuctmhhrhbcl.supabase.co',
    publishableKey: 'sb_publishable_A86vsSikZsyIf0eX5Lj_AQ_JqsHigRo',
  );
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'ScoreTracker',
      theme: ThemeData(colorScheme: .fromSeed(seedColor: Colors.deepPurple)),
      home: Scaffold(body: OnboardingPage()),
    );
  }
}
