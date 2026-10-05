// @hey-api/client-axios (generated in ./generated) references the DOM `BodyInit`
// type. React Native's TS lib doesn't expose `BodyInit` (it ships the fetch body
// type as `BodyInit_` to avoid clashing with the DOM lib). Alias it so the
// generated client typechecks without pulling the whole "dom" lib into RN.
declare type BodyInit = BodyInit_;
