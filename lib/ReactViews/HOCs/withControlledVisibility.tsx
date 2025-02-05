import React from "react";
import PropTypes from "prop-types";

import IElementConfig from "../../Models/IElementConfig";

interface WithControlledVisibilityProps {
  elementConfig: IElementConfig;
}

/**
 * Higher-order component that hides element, depending on whether
 * element is available inside either "hidden" or "shown" lists passed
 * as prop
 */
export default <P extends object>(WrappedComponent: React.ComponentType<P>) => {
  // eslint-disable-next-line require-jsdoc
  function WithControlledVisibility({
    elementConfig,
    ...props
  }: P & WithControlledVisibilityProps) {
    const isVisible = elementConfig ? elementConfig.visible : true;
    return isVisible ? <WrappedComponent {...(props as P)} /> : null;
  }

  WithControlledVisibility.propTypes = {
    elementConfig: PropTypes.object
  };

  return WithControlledVisibility;
};
