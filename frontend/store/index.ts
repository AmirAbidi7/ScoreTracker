import { configureStore } from "@reduxjs/toolkit";
import { useDispatch, useSelector } from "react-redux";
import scoreboardReducer from "../src/features/scoreTracking/scoreTrackingSlice";

export const store = configureStore({
  reducer: { scoreboard: scoreboardReducer },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

/**
 * `withTypes` is the Redux Toolkit 2.x / react-redux 9.x idiom: the store types
 * are supplied once, here, instead of being restated as a generic at every
 * call site. It is what makes `dispatch(sendIntent(...))` typecheck — the
 * untyped `useDispatch()` infers a dispatch that only accepts plain actions and
 * would reject every thunk.
 */
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
