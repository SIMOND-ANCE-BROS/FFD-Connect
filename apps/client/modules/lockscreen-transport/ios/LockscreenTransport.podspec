Pod::Spec.new do |s|
  s.name           = 'LockscreenTransport'
  s.version        = '1.0.0'
  s.summary        = 'Lock-screen next/previous track commands for the FFD Connect player'
  s.description    = 'Registers MPRemoteCommandCenter next/previous-track commands (which expo-audio does not wire) and forwards presses to JS, where the TrackPlayerWrapper queue handles them.'
  s.author         = 'FFD Connect'
  s.homepage       = 'https://github.com/gabinsimond/FFD-Connect'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,mm,swift}'
end
