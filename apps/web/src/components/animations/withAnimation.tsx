import React from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';

// --- DECORATOR PATTERN ---
// These Higher-Order Components (HOCs) "decorate" existing components with animation capabilities
// without modifying the original component's internal logic.

/**
 * Decorates a component to fade in and slide up slightly when it mounts.
 */
export function withFadeIn<T extends object>(WrappedComponent: React.ComponentType<T>) {
  return function FadeInWrapper(props: T) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      >
        <WrappedComponent {...props} />
      </motion.div>
    );
  };
}

/**
 * Decorates a component to scale up on hover and scale down on tap.
 * Useful for buttons or interactive cards.
 */
export function withHoverScale<T extends object>(
  WrappedComponent: React.ComponentType<T>,
  scaleUp = 1.02,
  scaleDown = 0.95
) {
  return function HoverScaleWrapper(props: T) {
    return (
      <motion.div
        whileHover={{ scale: scaleUp }}
        whileTap={{ scale: scaleDown }}
        transition={{ type: 'spring', stiffness: 400, damping: 17 }}
        style={{ display: 'inline-block', width: '100%' }}
      >
        <WrappedComponent {...props} />
      </motion.div>
    );
  };
}

/**
 * A wrapper for page transitions used within an <AnimatePresence> context.
 */
export const AnimatedPage: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      transition={{ duration: 0.25, ease: 'easeInOut' }}
    >
      {children}
    </motion.div>
  );
};

// --- STAGGERED LIST ANIMATIONS ---

const listVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 15 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } },
};

/**
 * Decorates a list container to stagger the appearance of its children.
 */
export const AnimatedList: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => {
  return (
    <motion.div
      variants={listVariants}
      initial="hidden"
      animate="show"
      className={className}
    >
      {children}
    </motion.div>
  );
};

/**
 * Decorates a single list item within an AnimatedList.
 */
export const AnimatedListItem: React.FC<{ children: React.ReactNode; className?: string } & HTMLMotionProps<"div">> = ({ children, className, ...rest }) => {
  return (
    <motion.div variants={itemVariants} className={className} {...rest}>
      {children}
    </motion.div>
  );
};
