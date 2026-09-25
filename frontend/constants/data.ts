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
    title: "Join",
    icon: QrCode,
  },
];

export const scores: Scoreboard = {
  id: "00000000-0000-4000-8000-000000000000",
  gameName: "Catan",
  code: "ABC123",
  updateTime: new Date(0).toISOString(),
  players: [
    {
      id: 1,
      name: "Amir",
      score: 20,
    },
    {
      id: 2,
      name: "Dolly",
      score: 10,
    },
    {
      id: 3,
      name: "Sally",
      score: 8,
    },
  ],
};
