import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { githubLoginPath } from "../api";

export function ClosingCtaSection() {
  return (
    <section
      aria-labelledby="closing-cta-heading"
      className="bg-primary text-primary-foreground"
    >
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-16 sm:px-6 md:py-20 lg:px-8">
        <h2
          id="closing-cta-heading"
          className="animate-in fade-in slide-in-from-bottom-4 fill-mode-both duration-700 motion-reduce:animate-none text-2xl font-bold tracking-tight md:text-3xl"
        >
          지금 GitHub 계정으로 시작하세요
        </h2>

        <p className="animate-in fade-in slide-in-from-bottom-4 fill-mode-both delay-100 duration-700 motion-reduce:animate-none max-w-xl text-sm leading-relaxed text-primary-foreground/80 md:text-base">
          로그인 후 나에게 맞는 오픈소스 프로그램을 찾아보세요.
        </p>

        <Button
          asChild
          size="lg"
          className="animate-in fade-in slide-in-from-bottom-4 fill-mode-both delay-200 duration-700 motion-reduce:animate-none bg-background text-primary hover:bg-background/90"
        >
          <a href={githubLoginPath}>
            GitHub으로 로그인
            <ArrowRight
              className="transition-transform duration-300 group-hover/button:translate-x-0.5"
              aria-hidden="true"
            />
          </a>
        </Button>
      </div>
    </section>
  );
}
