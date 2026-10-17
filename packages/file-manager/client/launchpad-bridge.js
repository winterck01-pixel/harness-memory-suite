export function registerLaunchpadApp(ctx, descriptor, label = 'launchpad-app') {
  ctx.inject(['dshLaunchpad'], scope => scope.effect(
    () => scope.get('dshLaunchpad').registerApp(descriptor),
    `dsh-launchpad: ${label}`,
  ))
}
