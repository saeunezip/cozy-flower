# 접속 시간·거래소 Worker 계약

프런트엔드는 기존 Worker의 `GET/POST /features`를 사용한다. 운영 Worker의 기존 Durable Object에 `profiles`와 `marketRequests` 키로 저장하며, 임무 보드·임무 횟수 데이터와 저장 영역을 분리한다. Worker 원본과 Wrangler 배포 구성은 이 프런트 저장소에 포함하지 않는다.

## 조회

`GET /features?viewer=<현재 선택한 내 이름>`는 다음 형태를 반환한다. 서버는 `viewer`가 최신 `snapshot.members`에 있는지 검사한다.

```json
{
  "ok": true,
  "viewer": { "member": "현재 서버가 확인한 길드원" },
  "profiles": { "새우": { "timeTags": ["오후반", "저녁반"] } },
  "requests": [
    {
      "id": "고정 ID",
      "requester": "가재",
      "target": "새우",
      "items": [{ "flower": "황금 장미", "quantity": "1000" }],
      "createdAt": "서버 시각 ISO 문자열",
      "completedAt": null,
      "canMutate": true
    }
  ]
}
```

`viewer.member`는 현재 브라우저가 선택해 전달했고 서버가 길드원 목록에서 확인한 이름이다. 서비스에 로그인 수단이 없으므로 강한 본인 인증은 아니다. 대리 조회 대상과 작성 폼의 의뢰인은 이 값에 영향을 주지 않는다.

## 쓰기

- `{ "action": "profile.setTimeTags", "member": "새우", "timeTags": ["오후반"] }`
- `{ "action": "market.create", "requester": "가재", "target": "새우", "items": [{"flower":"황금 장미","quantity":"1000"}] }`
- `{ "action": "market.toggleComplete", "id": "...", "actor": "현재 선택한 내 이름" }`

서버는 길드원 존재 여부, 대상자의 최신 보유 꽃, 서로 다른 꽃 1~4종, 중복 꽃 금지, 수량의 `/^[1-9]\d*$/` 조건을 다시 검사한다. 수량은 JS 정수로 변환하지 않고 문자열 또는 충분한 정밀도의 정수로 보존한다. 생성 요청은 재시도 중복을 막을 수 있도록 향후 idempotency key를 받는 편이 안전하다.

완료 변경은 `actor`가 최신 길드원 목록에 있고 의뢰인 또는 대상자일 때만 허용한다. 완료 시각은 서버 시각으로 기록하고, 취소 시 `completedAt`을 비운다. 다시 완료하면 새 서버 시각을 기록한다. 조회와 쓰기 모두 `completedAt + 1시간 <= 현재 서버 시각`인 항목을 반환하지 않아야 하며 저장 데이터 정리도 서버에서 수행한다. TTL이나 예약 작업은 삭제 직전에 현재 `completedAt`을 다시 비교하여 완료 취소 또는 재완료된 항목을 지우지 않아야 한다.

시간대는 KST 기준 `새벽반 00–06`, `오전반 06–12`, `오후반 12–18`, `저녁반 18–24`다. 종일반은 전 시간대에 포함되며 다른 태그와 함께 저장하지 않는다. 여러 일반 시간대는 함께 선택할 수 있다.
