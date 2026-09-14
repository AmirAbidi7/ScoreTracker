import { Scoreboard } from "@/features/scoreTracking/domain/Scoreboard";
import { Gamepad2, LucideIcon, Podium, QrCode } from "lucide-react-native/";
interface AppTab {
  name: string;
  title: string;
  icon: LucideIcon;
}
export const tabs: AppTab[] = [
  {
    name: "(scoreTracking)/scoreTracking",
    title: "Scoreboard",
    icon: Gamepad2,
  },
  {
    name: "(scoreTracking)/leaderboard",
    title: "Leaderboard",
    icon: Podium,
  },
  {
    name: "(scoreTracking)/syncGame",
    title: "Scoreboard",
    icon: QrCode,
  },
];

export const scores: Scoreboard = {
  id: 1,
  gameName: "Catan",
  players: [
    {
      name: "Amir",
      score: 20,
    },
    {
      name: "Dolly",
      score: 10,
    },
    {
      name: "Sally",
      score: 8,
    },
  ],
};
