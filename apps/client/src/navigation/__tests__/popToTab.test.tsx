import {
  createNavigatorFactory,
  createNavigationContainerRef,
  NavigationContainer,
  type NavigatorScreenParams,
  type ParamListBase,
  StackRouter,
  TabRouter,
  useNavigationBuilder,
} from "@react-navigation/native";
import { act, render } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";
import { create } from "zustand";
import { preloadReactNative } from "../../__tests__/mocks/preloadReactNative";

/**
 * #858: the competition detail opens the Career tab with
 * `popTo("Main", { screen: "Career" })`. The `screen` param stays on the
 * `Main` route; a profile switch re-mounts the tabs (MainTabs keys them by
 * role). The re-mounted tabs must open on their first tab, not on the tab
 * that param once asked for.
 *
 * The routers and the navigation builder are React Navigation's own (the ones
 * native-stack and bottom-tabs run on); only the views are stripped down,
 * since react-native-screens is mocked in jest. The stack keeps every route
 * mounted, like the native stack keeps `Main` under the detail screen.
 */
type Tabs = { Home: undefined; Career: undefined };
type Root = {
  Main: NavigatorScreenParams<Tabs> | undefined;
  Detail: undefined;
};

type NavigatorProps = {
  children: React.ReactNode;
  screenOptions?: object;
};

function StackNavigator({ children, screenOptions }: NavigatorProps) {
  const { state, descriptors, NavigationContent } = useNavigationBuilder(
    StackRouter,
    { children, screenOptions },
  );
  return (
    <NavigationContent>
      {state.routes.map((route) => (
        <React.Fragment key={route.key}>
          {descriptors[route.key].render()}
        </React.Fragment>
      ))}
    </NavigationContent>
  );
}

function TabNavigator({ children, screenOptions }: NavigatorProps) {
  const { state, descriptors, NavigationContent } = useNavigationBuilder(
    TabRouter,
    { children, screenOptions },
  );
  return (
    <NavigationContent>
      {descriptors[state.routes[state.index].key].render()}
    </NavigationContent>
  );
}

const createStack = createNavigatorFactory(StackNavigator);
const createTabs = createNavigatorFactory(TabNavigator);
const Stack = createStack<ParamListBase>();
const Tab = createTabs<ParamListBase>();
const Home = () => <Text>home-tab</Text>;
const Career = () => <Text>career-tab</Text>;
const Detail = () => <Text>detail</Text>;

preloadReactNative("Animated");

describe("popTo a tab, then a profile switch (#858)", () => {
  it("re-mounted tabs open on their first tab, not on the consumed param", async () => {
    const ref = createNavigationContainerRef<Root>();
    // Stands for the auth store MainTabs reads its role from.
    const useRole = create<{ role: string }>(() => ({ role: "LICENSEE" }));
    const MainTabs = () => {
      const role = useRole((s) => s.role);
      return (
        <Tab.Navigator
          key={`tabs-${role}`}
          screenOptions={{ headerShown: false }}
        >
          <Tab.Screen name="Home" component={Home} />
          {role === "LICENSEE" && (
            <Tab.Screen name="Career" component={Career} />
          )}
        </Tab.Navigator>
      );
    };
    const App = () => (
      <NavigationContainer ref={ref}>
        <Stack.Navigator>
          <Stack.Screen name="Main" component={MainTabs} />
          <Stack.Screen name="Detail" component={Detail} />
        </Stack.Navigator>
      </NavigationContainer>
    );
    await render(<App />);
    const focusedTab = () => {
      const main = ref.getRootState().routes[0];
      const tabs = main.state;
      return tabs?.routeNames?.[tabs.index ?? 0];
    };

    await act(async () => ref.navigate("Detail"));
    await act(async () =>
      // What CompetitionDetailScreen does.
      ref.dispatch({
        type: "POP_TO",
        payload: { name: "Main", params: { screen: "Career" } },
      }),
    );
    expect(focusedTab()).toBe("Career");

    // Profile switch: MainTabs re-keys its navigator.
    await act(async () => useRole.setState({ role: "ADMIN" }));
    expect(focusedTab()).toBe("Home");
    await act(async () => useRole.setState({ role: "LICENSEE" }));
    expect(focusedTab()).toBe("Home");
  });
});
