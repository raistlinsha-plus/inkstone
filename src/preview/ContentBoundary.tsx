import { Component, type ErrorInfo, type ReactNode } from "react";

export default class ContentBoundary extends Component<
  {
    children: ReactNode;
    source: string;
    label: string;
    onError?: (message: string) => void;
  },
  { error: string; source: string }
> {
  state = { error: "", source: this.props.source };
  static getDerivedStateFromProps(
    props: { source: string },
    state: { source: string },
  ) {
    return props.source === state.source
      ? null
      : { source: props.source, error: "" };
  }
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError?.(`${this.props.label}暂时无法呈现：${error.message}`);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="content-fallback" role="status">
        <p>{this.props.label}暂时无法呈现，原文已保留。可修改源码后重试。</p>
        <pre>
          <code>{this.props.source}</code>
        </pre>
      </section>
    );
  }
}
