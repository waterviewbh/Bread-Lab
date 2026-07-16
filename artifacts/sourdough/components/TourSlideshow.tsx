import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  Modal,
  PanResponder,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTourSlideshow } from '@/contexts/TourSlideshowContext';
import { TOUR_IMAGES, TOUR_IMAGE_COUNT } from '@/constants/TourImages';
export function TourSlideshow() {
  const { isTourVisible, hideTour } = useTourSlideshow();
  const router = useRouter();
  const [currentIndex, setCurrentIndex] = useState(0);  // Reset to slide 1 every time the tour opens
  useEffect(() => {
    if (isTourVisible) setCurrentIndex(0);
  }, [isTourVisible]);  // dismiss() is called from both the tap handler and the PanResponder.
  // The PanResponder handlers are frozen at creation time, so we keep
  // the latest dismiss in a ref so the gesture handler always sees it.
  const dismissRef = useRef<() => void>(() => {});
  const dismiss = useCallback(() => {
    hideTour();
    // Navigate to the About tab on exit; safe to call even if already there
    router.push('/about');
  }, [hideTour, router]);
  useEffect(() => {
    dismissRef.current = dismiss;
  }, [dismiss]);  // Single tap: advance to next slide, or dismiss on the last slide
  const handleTap = useCallback(() => {
    if (currentIndex < TOUR_IMAGE_COUNT - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      dismiss();
    }
  }, [currentIndex, dismiss]);  // PanResponder handles swipe-up-to-dismiss on both mobile and web.
  // onStartShouldSetPanResponder returns false so taps fall through
  // to the TouchableWithoutFeedback beneath; the responder only
  // activates once the finger has moved enough to be a clear gesture.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dy) > 10,
      onPanResponderRelease: (_, gs) => {
        // Require meaningful upward distance AND velocity to avoid accidents
        if (gs.dy < -80 && gs.vy < -0.3) {
          dismissRef.current();
        }
      },
    })
  ).current;
  return (
    <Modal
      visible={isTourVisible}
      transparent={false}
      animationType="fade"
      // Android hardware back button
      onRequestClose={dismiss}
      // Let the image paint behind the status bar on Android
      statusBarTranslucent
    >
      {/* Hide status bar while the slideshow is open */}
      {/* Gesture wrapper covers the full screen */}
      <StatusBar hidden={isTourVisible} />
      {/* Tap to advance; PanResponder defers to this for non-movement touches */}
      <View style={styles.container} {...panResponder.panHandlers}>
        <TouchableWithoutFeedback onPress={handleTap}>
          <Image
            source={TOUR_IMAGES[currentIndex]}
            style={styles.image}
            resizeMode="contain"
          />
        {/* Web only: close button in top-right corner (swipe isn't reliable via mouse) */}
        </TouchableWithoutFeedback>
        {Platform.OS === 'web' && (
          <TouchableOpacity
            style={styles.closeButton}
            onPress={dismiss}
            accessibilityLabel="Close tour"
            accessibilityRole="button"
          >
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  image: {
    flex: 1,
    width: '100%',
  },
  // Absolute overlay button — web only
  closeButton: {
    position: 'absolute',
    top: 48,
    right: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 20,
  },
});