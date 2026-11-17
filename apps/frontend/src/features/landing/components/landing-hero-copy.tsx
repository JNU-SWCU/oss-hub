import styles from './landing-journey.module.css';

export function LandingHeroCopy() {
  return (
    <>
      <span className={styles.eyebrow}>전남대학교 SW중심대학사업단</span>
      <h1 id="landing-hero-heading">흩어진 정보를 하나로</h1>
      <p>
        OSS Hub는 오픈소스 활동을 모아 역량으로 쌓아줍니다. 교내 활동, 팀
        프로젝트, 대외 활동 등의 제출 및 검토를 간편하게 만들어줍니다.
      </p>
    </>
  );
}
