// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { chartTemplate } from "../content/chart";
const mock = vi.hoisted(() => ({ init: vi.fn(), instances: [] as any[] }));
vi.mock("echarts/core", () => ({ use() {}, init: mock.init }));
vi.mock("echarts/charts", () => ({
  BarChart: {},
  LineChart: {},
  PieChart: {},
}));
vi.mock("echarts/components", () => ({
  TitleComponent: {},
  TooltipComponent: {},
  LegendComponent: {},
  GridComponent: {},
}));
vi.mock("echarts/renderers", () => ({ SVGRenderer: {} }));
test("sandbox verifies parent, data and revision before drawing or exporting", async () => {
  document.body.innerHTML = '<div id="graph"></div>';
  let viewportWidth = 800;
  mock.init.mockImplementation(() => {
    let width = viewportWidth;
    const instance = {
      dispose: vi.fn(),
      setOption: vi.fn(),
      resize: vi.fn(() => {
        width = viewportWidth;
      }),
      getWidth: () => width,
      getHeight: () => 400,
      getOption: () => ({ legend: [{ selected: { 收入: false } }] }),
      renderToSVGString: vi.fn(() => "<svg><text>2</text></svg>"),
    };
    mock.instances.push(instance);
    return instance;
  });
  const posted = vi
    .spyOn(window.parent, "postMessage")
    .mockImplementation(() => {});
  await import("./chart-runtime");
  const send = (data: object, source: Window = window.parent) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source,
        data: { channel: "safe", requestId: "one", revision: 1, ...data },
      }),
    );
  send({ type: "render", kind: "chart", source: chartTemplate }, {} as Window);
  expect(mock.init).not.toHaveBeenCalled();
  send({ type: "render", kind: "chart", source: chartTemplate });
  expect(mock.init).toHaveBeenCalledTimes(1);
  const reportHover = () => document.documentElement.dispatchEvent(new Event("pointermove"));
  const pointerEvents = () => posted.mock.calls.filter(([data]) => data.type === "diagram-pointer");
  reportHover();
  expect(pointerEvents()).toHaveLength(1);
  expect(pointerEvents()[0][0]).toMatchObject({ inside: true, requestId: "one", revision: 1 });
  send({ type: "command", action: "pointer-left-frame", requestId: "stale" });
  reportHover();
  expect(pointerEvents()).toHaveLength(1);
  send({ type: "command", action: "pointer-left-frame" });
  reportHover();
  expect(pointerEvents()).toHaveLength(2);
  expect(mock.instances[0].setOption.mock.calls[0][0].series[0].data).toEqual([
    120, 150, 138, 180,
  ]);
  send({
    type: "command",
    action: "export",
    requestId: "stale",
    format: "png",
  });
  expect(mock.instances[0].renderToSVGString).not.toHaveBeenCalled();
  expect(mock.init).toHaveBeenCalledTimes(1);
  send({
    type: "render",
    kind: "chart",
    source: chartTemplate,
    theme: "dark",
    preserveView: true,
  });
  expect(mock.init).toHaveBeenCalledTimes(1);
  expect(mock.instances[0].setOption).toHaveBeenLastCalledWith(
    expect.objectContaining({ backgroundColor: "#1e2220" }),
    { notMerge: false },
  );
  viewportWidth = 276;
  window.dispatchEvent(new Event("resize"));
  await vi.waitFor(() => expect(mock.instances[0].resize).toHaveBeenCalled());
  const narrowOption = mock.instances[0].setOption.mock.lastCall[0];
  expect(narrowOption.backgroundColor).toBe("#1e2220");
  expect(narrowOption.title.textStyle.width).toBeLessThan(viewportWidth);
  expect(narrowOption.xAxis.nameLocation).toBe("middle");
  send({ type: "command", action: "export", format: "png" });
  expect(mock.init).toHaveBeenLastCalledWith(null, undefined, {
    renderer: "svg",
    ssr: true,
    width: viewportWidth,
    height: 400,
  });
  expect(mock.instances[1].setOption).toHaveBeenCalledWith(
    expect.objectContaining({
      backgroundColor: "#fffefa",
      legend: expect.objectContaining({ selected: { 收入: false } }),
      title: expect.objectContaining({
        textStyle: expect.objectContaining({
          width: narrowOption.title.textStyle.width,
        }),
      }),
    }),
  );
  expect(mock.instances[1].dispose).toHaveBeenCalledOnce();
  expect(posted.mock.calls.at(-1)?.[0]).toMatchObject({
    type: "export",
    format: "png",
    requestId: "one",
    revision: 1,
  });
  send({
    type: "render",
    kind: "chart",
    source: chartTemplate,
    requestId: "two",
    revision: 2,
  });
  expect(mock.instances[0].dispose).toHaveBeenCalledOnce();
  send({
    type: "render",
    kind: "chart",
    source: chartTemplate.replace('"type": "bar"', '"type": "custom"'),
    requestId: "bad",
    revision: 3,
  });
  expect(mock.init).toHaveBeenCalledTimes(3);
  expect(mock.instances[2].dispose).toHaveBeenCalledOnce();
  expect(posted.mock.calls.at(-1)?.[0]).toMatchObject({
    type: "error",
    requestId: "bad",
    revision: 3,
  });
  send({ type: "command", action: "export", requestId: "bad", revision: 3 });
  expect(posted.mock.calls.at(-1)?.[0]).toMatchObject({ type: "error" });
});
