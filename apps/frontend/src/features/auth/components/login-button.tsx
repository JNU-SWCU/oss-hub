"use client";

import { useEffect, useState } from "react";
import { fetchMe, githubLoginPath, logout } from "../api";
import type { Me } from "../types";

export function LoginButton() {
  const [me, setMe] = useState<Me | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchMe()
      .then((user) => {
        if (active) setMe(user);
      })
      .catch(() => {
        if (active) setMe(null);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (isLoading) {
    return <p>로그인 상태 확인 중…</p>;
  }

  if (me) {
    return (
      <p>
        <strong>{me.login}</strong> 님으로 로그인됨{" "}
        <button
          type="button"
          onClick={() => {
            void logout().finally(() => setMe(null));
          }}
        >
          로그아웃
        </button>
      </p>
    );
  }

  return <a href={githubLoginPath}>GitHub으로 로그인</a>;
}
